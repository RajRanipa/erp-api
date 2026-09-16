import dotenv from 'dotenv';
import mongoose from 'mongoose';
import InventorySnapshot from '../models/InventorySnapshot.js';
import Item from '../models/Item.js';
import ItemFamily from '../models/ItemFamily.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';
import { postReceipt } from '../services/inventoryV2Service.js';
import { resolveLegacyItemReference } from '../services/legacyReferenceResolver.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const snapshots = await InventorySnapshot.find({ onHand: { $gt: 0 } })
    .sort({ companyId: 1, _id: 1 })
    .lean();
  const report = {
    mode: apply ? 'APPLY' : 'AUDIT',
    scanned: snapshots.length,
    candidates: 0,
    migrated: 0,
    duplicates: 0,
    openingQuantity: 0,
    blockers: [],
    warnings: [],
  };

  for (const snapshot of snapshots) {
    const resolved = await resolveLegacyItemReference(snapshot.companyId, snapshot.itemId);
    const mapping = resolved.item;
    if (!mapping) {
      report.blockers.push({
        snapshotId: snapshot._id,
        legacyItemId: snapshot.itemId,
        reason: resolved.reason || 'No active Item Master V2 mapping',
      });
      continue;
    }
    if (snapshot.reserved > 0) {
      report.blockers.push({
        snapshotId: snapshot._id,
        itemMasterId: mapping._id,
        reason: `Legacy reservation ${snapshot.reserved} must be released or migrated explicitly`,
      });
      continue;
    }
    if (mapping.trackingPolicy?.serialTracked) {
      report.blockers.push({
        snapshotId: snapshot._id,
        itemMasterId: mapping._id,
        reason: 'Serialized opening stock requires a roll-by-roll serial and PLC/PI weight file',
      });
      continue;
    }
    const family = await ItemFamily.findById(mapping.familyId).select('code').lean();
    const legacyItem = await Item.findById(snapshot.itemId)
      .select('purchasePrice categoryKey')
      .lean();
    const idempotencyKey = `MIGRATION:INVENTORY_V2:${snapshot._id}`;
    const existing = await InventoryTransactionV2.findOne({
      companyId: snapshot.companyId,
      idempotencyKey,
    }).select('_id').lean();
    if (existing) {
      report.duplicates++;
      continue;
    }
    report.candidates++;
    report.openingQuantity += snapshot.onHand;
    if (!apply) continue;

    try {
      const qualityStatus = legacyItem?.categoryKey === 'NC' && family?.code !== 'ET'
        ? 'REJECTED'
        : 'AVAILABLE';
      const result = await postReceipt(snapshot.companyId, null, {
        idempotencyKey,
        itemId: mapping._id,
        warehouseId: snapshot.warehouseId,
        bin: snapshot.bin,
        quantity: snapshot.onHand,
        unitCost: Number(legacyItem?.purchasePrice || 0),
        lotNo: snapshot.batchNo || `OPENING-${String(snapshot._id).slice(-8)}`,
        qualityStatus,
        processStatus: qualityStatus === 'REJECTED' ? 'REJECTED' : 'AVAILABLE',
        sourceType: 'MIGRATION',
        sourceId: String(snapshot._id),
        referenceType: 'OPENING_BALANCE',
        referenceId: String(snapshot._id),
      });
      if (result.duplicate) report.duplicates++;
      else report.migrated++;
      if (!(Number(legacyItem?.purchasePrice) > 0)) {
        report.warnings.push({
          snapshotId: snapshot._id,
          itemMasterId: mapping._id,
          warning: 'Opening stock migrated with zero cost; finance should post a valuation adjustment',
        });
      }
    } catch (error) {
      report.blockers.push({
        snapshotId: snapshot._id,
        itemMasterId: mapping._id,
        reason: error.message,
      });
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mongoose.disconnect();
}
