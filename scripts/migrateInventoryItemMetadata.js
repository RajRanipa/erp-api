import dotenv from 'dotenv';
import mongoose from 'mongoose';
import InventoryLedger from '../models/InventoryLedger.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import Item from '../models/Item.js';

dotenv.config();

async function migrateInventoryItemMetadata() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const items = await Item.find({})
    .select('_id categoryKey productType')
    .lean();

  let ledgerUpdated = 0;
  let snapshotsUpdated = 0;

  for (const item of items) {
    if (!['FG', 'RAW', 'PACKING', 'NC'].includes(item.categoryKey)) continue;
    if (item.categoryKey === 'FG' && !item.productType) {
      console.warn(`Skipping FG item without productType: ${item._id}`);
      continue;
    }

    const metadata = {
      categoryKey: item.categoryKey,
      productType: item.productType || null,
    };

    const [ledgerResult, snapshotResult] = await Promise.all([
      InventoryLedger.updateMany(
        { itemId: item._id },
        { $set: metadata }
      ),
      InventorySnapshot.updateMany(
        { itemId: item._id },
        { $set: metadata }
      ),
    ]);

    ledgerUpdated += ledgerResult.modifiedCount || 0;
    snapshotsUpdated += snapshotResult.modifiedCount || 0;
  }

  console.log(
    `Inventory metadata migration complete: ${ledgerUpdated} ledger rows and ${snapshotsUpdated} snapshots updated.`
  );
}

migrateInventoryItemMetadata()
  .catch((error) => {
    console.error('Inventory metadata migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
