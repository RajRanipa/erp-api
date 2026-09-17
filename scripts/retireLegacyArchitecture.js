import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const apply = process.argv.includes('--apply');
const includeHistory = process.argv.includes('--include-history');
const backupConfirmed = process.argv.includes('--backup-confirmed');
const confirmation = process.argv
  .find(argument => argument.startsWith('--confirm='))
  ?.slice('--confirm='.length);
const requiredConfirmation = 'RETIRE_LEGACY_ARCHITECTURE';
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

const LEGACY_REFERENCE_COLLECTIONS = Object.freeze([
  'items',
  'categories',
  'densities',
  'dimensions',
  'producttypes',
  'temperatures',
  'products',
  'rawmaterials',
  'packingmaterials',
  'boms',
  'inventorymoves',
  'workorders',
]);

const LEGACY_HISTORY_COLLECTIONS = Object.freeze([
  'inventoryledgers',
  'inventorysnapshots',
  'batches',
]);

const isLegacySnapshotBackup = name => name.startsWith('inventorysnapshots_backup_');

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = new Set(collections.map(collection => collection.name));
  const backupCollections = [...collectionNames].filter(isLegacySnapshotBackup).sort();
  const candidates = [
    ...LEGACY_REFERENCE_COLLECTIONS,
    ...LEGACY_HISTORY_COLLECTIONS,
    ...backupCollections,
  ];
  const counts = {};
  for (const name of candidates) {
    counts[name] = collectionNames.has(name)
      ? await db.collection(name).estimatedDocumentCount()
      : 0;
  }

  const current = {
    itemMasters: collectionNames.has('itemmasters')
      ? await db.collection('itemmasters').estimatedDocumentCount()
      : 0,
    inventoryBalances: collectionNames.has('inventorybalancev2')
      ? await db.collection('inventorybalancev2').estimatedDocumentCount()
      : 0,
    inventoryLots: collectionNames.has('inventorylotv2')
      ? await db.collection('inventorylotv2').estimatedDocumentCount()
      : 0,
    inventorySerials: collectionNames.has('inventoryserialv2')
      ? await db.collection('inventoryserialv2').estimatedDocumentCount()
      : 0,
    inventoryTransactions: collectionNames.has('inventorytransactionv2')
      ? await db.collection('inventorytransactionv2').estimatedDocumentCount()
      : 0,
    manufacturingRecipes: collectionNames.has('manufacturingrecipev2')
      ? await db.collection('manufacturingrecipev2').estimatedDocumentCount()
      : 0,
    productionOrders: collectionNames.has('productionorderv2')
      ? await db.collection('productionorderv2').estimatedDocumentCount()
      : 0,
  };

  const blockers = [];
  if (!current.itemMasters) {
    blockers.push({ scope: 'items', reason: 'No current Item Master records exist' });
  }

  if (collectionNames.has('inventorysnapshots')) {
    const nonZeroSnapshots = await db.collection('inventorysnapshots').countDocuments({
      $or: [
        { onHand: { $ne: 0 } },
        { reserved: { $ne: 0 } },
        { available: { $ne: 0 } },
      ],
    });
    if (nonZeroSnapshots) {
      blockers.push({
        scope: 'inventorysnapshots',
        count: nonZeroSnapshots,
        reason: 'Legacy stock is still non-zero and has not been reconciled into current inventory',
      });
    }
  }

  if (collectionNames.has('productionblanketrolls')) {
    const pendingGatewayRecords = await db.collection('productionblanketrolls').countDocuments({
      inventoryV2Posted: { $ne: true },
      inventoryV2Status: { $nin: ['NOT_APPLICABLE'] },
    });
    if (pendingGatewayRecords) {
      blockers.push({
        scope: 'productionblanketrolls',
        count: pendingGatewayRecords,
        reason: 'Gateway production records are not linked to current inventory',
      });
    }
  }

  const itemMasterIds = collectionNames.has('itemmasters')
    ? new Set((await db.collection('itemmasters').find({}, { projection: { _id: 1 } }).toArray())
      .map(document => String(document._id)))
    : new Set();
  for (const definition of [
    { collection: 'purchaseorders', paths: ['lines'] },
    { collection: 'goodsreceipts', paths: ['lines'] },
    { collection: 'purchasereturns', paths: ['lines'] },
    { collection: 'purchaseinvoices', paths: ['lines', 'variances'] },
  ]) {
    if (!collectionNames.has(definition.collection)) continue;
    let invalidReferences = 0;
    for await (const document of db.collection(definition.collection).find({})) {
      for (const path of definition.paths) {
        for (const row of Array.isArray(document[path]) ? document[path] : []) {
          if (row?.itemId && !itemMasterIds.has(String(row.itemId))) invalidReferences += 1;
        }
      }
    }
    if (invalidReferences) {
      blockers.push({
        scope: definition.collection,
        count: invalidReferences,
        reason: 'Procurement rows still reference an ID outside Item Master',
      });
    }
  }

  const historyCount = LEGACY_HISTORY_COLLECTIONS
    .reduce((total, name) => total + Number(counts[name] || 0), 0)
    + backupCollections.reduce((total, name) => total + Number(counts[name] || 0), 0);
  if (historyCount && !includeHistory) {
    blockers.push({
      scope: 'legacy-history',
      count: historyCount,
      reason: 'Historical ledger, stock, batch, or backup rows exist; archive them before retirement',
    });
  }

  const report = {
    mode: apply ? 'APPLY' : 'AUDIT',
    current,
    legacyCollections: counts,
    includeHistory,
    blockers,
    droppedCollections: [],
  };

  if (apply) {
    if (confirmation !== requiredConfirmation) {
      throw new Error(`Apply requires --confirm=${requiredConfirmation}`);
    }
    if (!backupConfirmed) {
      throw new Error('Apply requires --backup-confirmed after a verified database backup');
    }
    if (blockers.length) {
      throw new Error(`Legacy retirement blocked by ${blockers.length} unresolved audit finding(s)`);
    }
    const dropCandidates = includeHistory ? candidates : LEGACY_REFERENCE_COLLECTIONS;
    for (const name of dropCandidates) {
      if (!collectionNames.has(name)) continue;
      await db.collection(name).drop();
      report.droppedCollections.push(name);
    }
  }

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    mode: apply ? 'APPLY' : 'AUDIT',
    error: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
