import dotenv from 'dotenv';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import Campaign from '../models/Campaign.js';
import Company from '../models/Company.js';
import InventoryBalanceV2 from '../models/InventoryBalanceV2.js';
import InventoryLotV2 from '../models/InventoryLotV2.js';
import InventorySerialV2 from '../models/InventorySerialV2.js';
import ItemMaster from '../models/ItemMaster.js';
import Warehouse from '../models/Warehouse.js';
import { generateInventorySerialBatch } from '../utils/serialNumber.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const fileArg = process.argv.find(argument => argument.startsWith('--file='));
const filePath = fileArg?.slice('--file='.length);
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!filePath || !mongoUri) {
  console.error('Usage: npm run serials:backfill -- --file=/absolute/path.xlsx [--apply]');
  process.exit(1);
}

const value = (row, ...keys) => {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, entry]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ''),
    entry,
  ]));
  return keys.map(key => normalized[key]).find(entry => entry !== undefined && entry !== '');
};
const asDate = (input, rowNumber) => {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`Row ${rowNumber}: manufacturedAt is invalid`);
  return date;
};
const humanize = input => String(input || '').replaceAll('_', ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());

const workbook = XLSX.readFile(filePath, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
if (!rows.length) throw new Error('The backfill file contains no rows');

const normalizedRows = rows.map((row, index) => {
  const rowNumber = index + 2;
  const itemSku = String(value(row, 'itemsku', 'sku') || '').trim().toUpperCase();
  const warehouseCode = String(value(row, 'warehousecode', 'warehouse') || '').trim().toUpperCase();
  const lotNo = String(value(row, 'lotno', 'lot') || '').trim().toUpperCase();
  const campaignName = String(value(row, 'campaignname', 'campaign') || '').trim();
  const weightKg = Number(value(row, 'weightkg', 'weight'));
  if (!itemSku || !warehouseCode || !lotNo) {
    throw new Error(`Row ${rowNumber}: itemSku, warehouseCode and lotNo are required`);
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error(`Row ${rowNumber}: weightKg must be greater than zero`);
  }
  return {
    rowNumber,
    itemSku,
    warehouseCode,
    lotNo,
    campaignName,
    weightKg,
    manufacturedAt: asDate(value(row, 'manufacturedat', 'manufactureddatetime'), rowNumber),
  };
});

const groups = new Map();
for (const row of normalizedRows) {
  const key = `${row.itemSku}|${row.warehouseCode}|${row.lotNo}`;
  groups.set(key, [...(groups.get(key) || []), row]);
}

await mongoose.connect(mongoUri, { autoIndex: false });
try {
  const report = { mode: apply ? 'APPLY' : 'AUDIT', rows: rows.length, groups: [], blockers: [] };
  for (const [key, unitRows] of groups) {
    try {
      const warehouse = await Warehouse.findOne({
        code: unitRows[0].warehouseCode,
        status: 'active',
      }).lean();
      const item = warehouse
        ? await ItemMaster.findOne({
          companyId: warehouse.companyId,
          sku: unitRows[0].itemSku,
          status: 'active',
        }).lean()
        : null;
      if (!item || !warehouse) {
        throw new Error('Active Item/Warehouse pair was not found in one company');
      }
      if (!item.trackingPolicy?.serialTracked) throw new Error('Item is not configured for serial tracking');
      const lot = await InventoryLotV2.findOne({
        companyId: item.companyId,
        itemId: item._id,
        warehouseId: warehouse._id,
        lotNo: unitRows[0].lotNo,
        status: 'OPEN',
      }).lean();
      if (!lot) throw new Error('Open inventory lot was not found');
      if (Math.abs(Number(lot.originalQuantity) - Number(lot.onHandQuantity)) > 0.000001) {
        throw new Error('Lot has historical issues; automatic opening-stock backfill is unsafe');
      }
      const activeSerialCount = await InventorySerialV2.countDocuments({
        companyId: item.companyId,
        lotId: lot._id,
        state: { $in: ['AVAILABLE', 'RESERVED'] },
      });
      const missingUnits = Number(lot.onHandQuantity) - activeSerialCount;
      if (unitRows.length !== missingUnits) {
        throw new Error(`File has ${unitRows.length} rows but lot requires exactly ${missingUnits}`);
      }
      const balances = await InventoryBalanceV2.find({
        companyId: item.companyId,
        lotId: lot._id,
        onHand: { $gt: 0 },
      }).lean();
      if (balances.length !== 1 || Math.abs(Number(balances[0].onHand) - Number(lot.onHandQuantity)) > 0.000001) {
        throw new Error('Lot is split across balance states; use a reviewed custom migration');
      }
      const campaignNames = [...new Set(unitRows.map(row => row.campaignName).filter(Boolean))];
      if (campaignNames.length > 1) throw new Error('One lot cannot reference multiple campaigns');
      const campaign = campaignNames[0]
        ? await Campaign.findOne({ companyId: item.companyId, name: campaignNames[0] }).lean()
        : null;
      if (campaignNames[0] && !campaign) throw new Error('Campaign was not found for the company');
      const company = await Company.findById(item.companyId).select('companyName').lean();
      const totalWeight = Number(unitRows.reduce((sum, row) => sum + row.weightKg, 0).toFixed(6));
      const specifications = (item.attributes || []).map(attribute => ({
        code: attribute.code,
        label: humanize(attribute.code),
        value: attribute.displayValue || attribute.normalizedValue,
        unit: attribute.unit || null,
      }));
      const serialNos = generateInventorySerialBatch(unitRows.length);
      report.groups.push({ key, lotId: lot._id, units: unitRows.length, totalWeight });
      if (!apply) continue;

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await InventorySerialV2.insertMany(unitRows.map((row, index) => ({
            companyId: item.companyId,
            itemId: item._id,
            lotId: lot._id,
            campaignId: campaign?._id || null,
            serialNo: serialNos[index],
            warehouseId: warehouse._id,
            bin: lot.bin,
            state: 'AVAILABLE',
            qualityStatus: lot.qualityStatus === 'AVAILABLE' ? 'ACCEPTED' : lot.qualityStatus,
            baseQuantity: 1,
            catchQuantity: row.weightKg,
            catchUom: item.catchUom || 'kg',
            catchSource: 'MANUAL',
            manufacturedAt: row.manufacturedAt,
            measuredAt: new Date(),
            manualReason: 'Verified opening-stock serial backfill',
            sourceType: 'OPENING_BACKFILL',
            sourceId: String(lot._id),
            traceSnapshot: {
              manufacturerName: company.companyName,
              productName: item.name,
              sku: item.sku,
              campaignName: campaign?.name || null,
              lotNo: lot.lotNo,
              specifications,
            },
          })), { session, ordered: true });
          await InventoryLotV2.updateOne(
            { _id: lot._id },
            { $set: {
              campaignId: campaign?._id || lot.campaignId || null,
              originalCatchQuantity: totalWeight,
              onHandCatchQuantity: totalWeight,
            } },
            { session },
          );
          await InventoryBalanceV2.updateOne(
            { _id: balances[0]._id },
            { $set: { catchOnHand: totalWeight, catchUom: item.catchUom || 'kg' } },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
    } catch (error) {
      report.blockers.push({ key, reason: error.message });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
