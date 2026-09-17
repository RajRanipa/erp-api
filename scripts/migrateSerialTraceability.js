import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Batch from '../models/Batches.js';
import Campaign from '../models/Campaign.js';
import Company from '../models/Company.js';
import InventoryBalanceV2 from '../models/InventoryBalance.js';
import '../models/InventoryLot.js';
import InventorySerialV2 from '../models/InventorySerial.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import User from '../models/User.js';
import {
  generateInventorySerial,
  isValidInventorySerial,
} from '../utils/serialNumber.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

const humanize = value => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const report = {
    mode: apply ? 'APPLY' : 'AUDIT',
    campaignsScanned: 0,
    campaignsScoped: 0,
    blanketFamiliesPlanned: 0,
    blanketFamiliesUpdated: 0,
    blanketItemsPlanned: 0,
    blanketItemsUpdated: 0,
    serialsScanned: 0,
    serialNumbersReplaced: 0,
    traceSnapshotsBackfilled: 0,
    stockChecks: 0,
    blockers: [],
  };
  const companies = await Company.find({}).select('_id companyName').lean();
  const companyById = new Map(companies.map(company => [String(company._id), company]));

  const campaigns = await Campaign.find({}).select('companyId name createdBy').lean();
  report.campaignsScanned = campaigns.length;
  for (const campaign of campaigns) {
    if (campaign.companyId) continue;
    const candidates = new Set();
    const [batchCompanies, productionCompanies, creator] = await Promise.all([
      Batch.distinct('companyId', { campaign: campaign._id }),
      ProductionBlanketRoll.distinct('companyId', { campaign: campaign._id }),
      campaign.createdBy
        ? User.findById(campaign.createdBy).select('companyId').lean()
        : null,
    ]);
    [...batchCompanies, ...productionCompanies, creator?.companyId]
      .filter(Boolean)
      .forEach(id => candidates.add(String(id)));
    if (!candidates.size && companies.length === 1) candidates.add(String(companies[0]._id));
    if (candidates.size !== 1) {
      report.blockers.push({
        campaignId: campaign._id,
        campaignName: campaign.name,
        reason: 'Campaign company could not be inferred uniquely',
        candidateCompanyIds: [...candidates],
      });
      continue;
    }
    report.campaignsScoped += 1;
    if (apply) {
      await Campaign.collection.updateOne(
        { _id: campaign._id },
        { $set: { companyId: new mongoose.Types.ObjectId([...candidates][0]) } },
      );
      campaign.companyId = new mongoose.Types.ObjectId([...candidates][0]);
    }
  }

  const blanketFamilies = await ItemFamily.find({ code: 'BLANKET' }).select('_id companyId').lean();
  for (const family of blanketFamilies) {
    report.blanketFamiliesPlanned += 1;
    report.blanketItemsPlanned += await ItemMaster.countDocuments({
      companyId: family.companyId,
      familyId: family._id,
    });
  }

  const usedSerials = new Set();
  const serials = await InventorySerialV2.find({})
    .populate('itemId', 'sku name attributes')
    .populate('lotId', 'lotNo campaignId')
    .populate('campaignId', 'name companyId')
    .populate('companyId', 'companyName')
    .sort({ createdAt: 1, _id: 1 });
  report.serialsScanned = serials.length;
  for (const serial of serials) {
    let replacement = serial.serialNo;
    if (!isValidInventorySerial(replacement) || usedSerials.has(replacement)) {
      do replacement = generateInventorySerial(); while (usedSerials.has(replacement));
      report.serialNumbersReplaced += 1;
    }
    usedSerials.add(replacement);
    let campaignId = serial.campaignId?._id || serial.lotId?.campaignId || null;
    if (!campaignId && serial.sourceType === 'PROD_GATEWAY' && serial.sourceId) {
      campaignId = (await ProductionBlanketRoll.findById(serial.sourceId)
        .select('campaign').lean())?.campaign || null;
    }
    const campaign = campaignId
      ? await Campaign.findById(campaignId).select('name').lean()
      : null;
    const snapshot = serial.traceSnapshot || {
      manufacturerName: serial.companyId?.companyName
        || companyById.get(String(serial.companyId))?.companyName
        || 'Unknown manufacturer',
      productName: serial.itemId?.name || 'Unknown product',
      sku: serial.itemId?.sku || 'UNKNOWN',
      campaignName: campaign?.name || null,
      lotNo: serial.lotId?.lotNo || 'UNKNOWN',
      specifications: (serial.itemId?.attributes || []).map(attribute => ({
        code: attribute.code,
        label: humanize(attribute.code),
        value: attribute.displayValue || attribute.normalizedValue,
        unit: attribute.unit || null,
      })),
    };
    if (!serial.traceSnapshot) report.traceSnapshotsBackfilled += 1;
    if (apply) {
      await InventorySerialV2.collection.updateOne(
        { _id: serial._id },
        { $set: {
          serialNo: replacement,
          legacySerialNo: replacement === serial.serialNo ? serial.legacySerialNo : serial.serialNo,
          campaignId,
          traceSnapshot: snapshot,
        } },
      );
      if (serial.sourceType === 'PROD_GATEWAY' && serial.sourceId) {
        await ProductionBlanketRoll.updateOne(
          { _id: serial.sourceId },
          { $set: { inventoryV2SerialId: serial._id, inventoryV2SerialNo: replacement } },
        );
      }
    }
  }

  const serializedItems = await ItemMaster.find({
    'trackingPolicy.serialTracked': true,
    status: 'active',
  }).select('_id companyId sku name catchUom').lean();
  for (const item of serializedItems) {
    const [balance, serialBalance] = await Promise.all([
      InventoryBalanceV2.aggregate([
        { $match: { companyId: item.companyId, itemId: item._id, onHand: { $gt: 0 } } },
        { $group: { _id: null, quantity: { $sum: '$onHand' }, weight: { $sum: '$catchOnHand' } } },
      ]),
      InventorySerialV2.aggregate([
        {
          $match: {
            companyId: item.companyId,
            itemId: item._id,
            state: { $in: ['AVAILABLE', 'RESERVED'] },
          },
        },
        { $group: { _id: null, quantity: { $sum: '$baseQuantity' }, weight: { $sum: '$catchQuantity' } } },
      ]),
    ]);
    report.stockChecks += 1;
    const stockQuantity = Number(balance[0]?.quantity || 0);
    const serialQuantity = Number(serialBalance[0]?.quantity || 0);
    const stockWeight = Number(balance[0]?.weight || 0);
    const serialWeight = Number(serialBalance[0]?.weight || 0);
    if (
      Math.abs(stockQuantity - serialQuantity) > 0.000001
      || Math.abs(stockWeight - serialWeight) > 0.001
    ) {
      report.blockers.push({
        itemId: item._id,
        sku: item.sku,
        name: item.name,
        reason: 'On-hand inventory does not reconcile to active serial units',
        stockQuantity,
        serialQuantity,
        stockWeight,
        serialWeight,
      });
    }
  }

  if (apply) {
    for (const family of blanketFamilies) {
      await ItemFamily.updateOne(
        { _id: family._id },
        { $set: {
          'trackingPolicy.serialTracked': true,
          'trackingPolicy.serialControlMode': 'INFORMATIONAL',
        } },
      );
      report.blanketFamiliesUpdated += 1;
      const itemResult = await ItemMaster.updateMany(
        { companyId: family.companyId, familyId: family._id },
        { $set: {
          'trackingPolicy.serialTracked': true,
          'trackingPolicy.serialControlMode': 'INFORMATIONAL',
        } },
      );
      report.blanketItemsUpdated += itemResult.matchedCount;
    }
  }

  if (apply && !report.blockers.some(blocker => blocker.campaignId)) {
    const campaignIndexes = await Campaign.collection.indexes();
    const globalRunning = campaignIndexes.find(index => index.name === 'status_1');
    if (globalRunning) await Campaign.collection.dropIndex(globalRunning.name);
    await Campaign.collection.createIndex(
      { companyId: 1, status: 1 },
      {
        unique: true,
        name: 'companyId_1_status_1',
        partialFilterExpression: { status: 'RUNNING' },
      },
    );
    const serialIndexes = await InventorySerialV2.collection.indexes();
    const oldSerialIndex = serialIndexes.find(
      index => index.name === 'uniq_company_v2_inventory_serial',
    );
    if (oldSerialIndex) await InventorySerialV2.collection.dropIndex(oldSerialIndex.name);
    await InventorySerialV2.collection.createIndex(
      { serialNo: 1 },
      { unique: true, name: 'uniq_global_v2_inventory_serial' },
    );
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
