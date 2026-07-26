import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';

const VALID_CATEGORY_KEYS = new Set(['FG', 'RAW', 'PACKING', 'NC']);
const EPSILON = 1e-9;

const normalizeOptional = value => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const normalizeUom = value => String(value ?? '').trim().toLowerCase();

const sameNumber = (left, right) =>
  Math.abs(Number(left || 0) - Number(right || 0)) <= EPSILON;

const bucketKey = ({
  companyId,
  itemId,
  warehouseId,
  bin,
  batchNo,
  uom,
}) => JSON.stringify([
  String(companyId || ''),
  String(itemId || ''),
  String(warehouseId || ''),
  normalizeOptional(bin),
  normalizeOptional(batchNo),
  normalizeUom(uom),
]);

const addToMap = (map, key, amount) => {
  map.set(key, (map.get(key) || 0) + Number(amount || 0));
};

async function replaceSnapshots({
  snapshots,
  canonicalBuckets,
  backupCollectionName,
}) {
  const existingCount = await snapshots.countDocuments({});
  if (existingCount) {
    await snapshots.aggregate([{ $match: {} }, { $out: backupCollectionName }]).toArray();
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await snapshots.deleteMany({}, { session });
      const docs = [...canonicalBuckets.values()]
        .filter(bucket => (
          Math.abs(bucket.onHand) > EPSILON ||
          Math.abs(bucket.reserved) > EPSILON
        ))
        .map(bucket => ({
          ...bucket,
          available: bucket.onHand - bucket.reserved,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

      for (let index = 0; index < docs.length; index += 1000) {
        await snapshots.insertMany(docs.slice(index, index + 1000), { session });
      }
    });
  } finally {
    await session.endSession();
  }
}

export async function migrateInventoryItemMetadata({
  applyChanges = process.argv.includes('--apply'),
  mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI,
} = {}) {
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');

  await mongoose.connect(mongoUri, { autoIndex: false });
  try {
    const db = mongoose.connection.db;
    const items = db.collection('items');
    const ledgers = db.collection('inventoryledgers');
    const snapshots = db.collection('inventorysnapshots');
    const warehouses = db.collection('warehouses');
    const companies = db.collection('companies');

    const [itemDocs, warehouseDocs, companyDocs] = await Promise.all([
      items.find({}).project({
        _id: 1,
        companyId: 1,
        name: 1,
        categoryKey: 1,
        productType: 1,
        UOM: 1,
        currentStock: 1,
      }).toArray(),
      warehouses.find({}).toArray(),
      companies.find({}).project({ _id: 1 }).toArray(),
    ]);
    const itemById = new Map(itemDocs.map(item => [String(item._id), item]));

    // Infer legacy Warehouse ownership from inventory usage. If the database
    // has only one Company, unused Warehouses can safely inherit that Company.
    const warehouseUsage = new Map();
    for (const collection of [ledgers, snapshots]) {
      const usage = await collection.aggregate([
        {
          $match: {
            warehouseId: { $ne: null },
            companyId: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$warehouseId',
            companyIds: { $addToSet: '$companyId' },
          },
        },
      ]).toArray();
      for (const row of usage) {
        const key = String(row._id);
        const values = warehouseUsage.get(key) || new Set();
        row.companyIds.forEach(companyId => values.add(String(companyId)));
        warehouseUsage.set(key, values);
      }
    }

    const warehouseById = new Map();
    const warehouseUpdates = [];
    const unresolvedWarehouses = [];
    for (const warehouse of warehouseDocs) {
      const usageCompanies = warehouseUsage.get(String(warehouse._id)) || new Set();
      let companyId = warehouse.companyId || null;
      if (!companyId && usageCompanies.size === 1) {
        companyId = new mongoose.Types.ObjectId([...usageCompanies][0]);
      } else if (!companyId && usageCompanies.size === 0 && companyDocs.length === 1) {
        companyId = companyDocs[0]._id;
      }

      if (!companyId || usageCompanies.size > 1) {
        unresolvedWarehouses.push({
          warehouseId: warehouse._id,
          code: warehouse.code,
          companyIds: [...usageCompanies],
          reason: !companyId
            ? 'Unable to infer companyId'
            : 'Warehouse is used by more than one Company',
        });
        continue;
      }

      const canonical = {
        ...warehouse,
        companyId,
        code: String(warehouse.code || '').trim().toUpperCase(),
        status: warehouse.status || 'active',
      };
      warehouseById.set(String(warehouse._id), canonical);
      if (
        String(warehouse.companyId || '') !== String(companyId) ||
        warehouse.code !== canonical.code ||
        !warehouse.status
      ) {
        warehouseUpdates.push({
          updateOne: {
            filter: { _id: warehouse._id },
            update: {
              $set: {
                companyId,
                code: canonical.code,
                status: canonical.status,
              },
            },
          },
        });
      }
    }

    const warehouseCodeGroups = new Map();
    for (const warehouse of warehouseById.values()) {
      const key = `${warehouse.companyId}:${warehouse.code}`;
      const ids = warehouseCodeGroups.get(key) || [];
      ids.push(warehouse._id);
      warehouseCodeGroups.set(key, ids);
    }
    const duplicateWarehouseCodes = [...warehouseCodeGroups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([identity, ids]) => ({ identity, ids }));

    const blockers = {
      unresolvedWarehouses,
      duplicateWarehouseCodes,
      orphanLedgerRows: [],
      orphanSnapshotRows: [],
      companyMismatches: [],
      warehouseMismatches: [],
      invalidItems: [],
      invalidLedgerRows: [],
      unledgeredSnapshotBalances: [],
      negativeBuckets: [],
      overReservedBuckets: [],
      duplicateIdempotencyKeys: [],
      legacyCurrentStockOnly: [],
    };

    const ledgerTotals = new Map();
    const canonicalBuckets = new Map();
    const ledgerOperations = [];
    let ledgerRows = 0;
    let ledgerUpdates = 0;

    const flushLedgerOperations = async () => {
      if (!applyChanges || !ledgerOperations.length) return;
      await ledgers.bulkWrite(ledgerOperations.splice(0), { ordered: false });
    };

    for await (const row of ledgers.find({})) {
      ledgerRows += 1;
      const item = itemById.get(String(row.itemId));
      if (!item) {
        blockers.orphanLedgerRows.push(row._id);
        continue;
      }
      if (
        !item.companyId ||
        !VALID_CATEGORY_KEYS.has(item.categoryKey) ||
        !normalizeUom(item.UOM) ||
        (item.categoryKey === 'FG' && !item.productType)
      ) {
        blockers.invalidItems.push({
          itemId: item._id,
          name: item.name,
          source: 'ledger',
        });
        continue;
      }
      if (String(row.companyId) !== String(item.companyId)) {
        blockers.companyMismatches.push({
          rowId: row._id,
          itemId: item._id,
          inventoryCompanyId: row.companyId,
          itemCompanyId: item.companyId,
        });
        continue;
      }
      const warehouse = warehouseById.get(String(row.warehouseId));
      if (!warehouse || String(warehouse.companyId) !== String(row.companyId)) {
        blockers.warehouseMismatches.push({
          rowId: row._id,
          warehouseId: row.warehouseId,
          companyId: row.companyId,
          source: 'ledger',
        });
        continue;
      }
      if (!Number.isFinite(row.quantity) || row.quantity === 0) {
        blockers.invalidLedgerRows.push({
          rowId: row._id,
          quantity: row.quantity,
        });
        continue;
      }

      const canonical = {
        companyId: item.companyId,
        itemId: item._id,
        categoryKey: item.categoryKey,
        productType: item.productType || null,
        warehouseId: row.warehouseId,
        bin: normalizeOptional(row.bin),
        batchNo: normalizeOptional(row.batchNo),
        uom: normalizeUom(item.UOM),
      };
      const key = bucketKey(canonical);
      addToMap(ledgerTotals, key, row.quantity);
      if (!canonicalBuckets.has(key)) {
        canonicalBuckets.set(key, { ...canonical, onHand: 0, reserved: 0 });
      }

      const requiresUpdate = (
        row.categoryKey !== canonical.categoryKey ||
        String(row.productType || '') !== String(canonical.productType || '') ||
        normalizeUom(row.uom) !== canonical.uom ||
        row.bin !== canonical.bin ||
        row.batchNo !== canonical.batchNo
      );
      if (requiresUpdate) {
        ledgerUpdates += 1;
        if (applyChanges) {
          ledgerOperations.push({
            updateOne: {
              filter: { _id: row._id },
              update: {
                $set: {
                  categoryKey: canonical.categoryKey,
                  productType: canonical.productType,
                  uom: canonical.uom,
                  bin: canonical.bin,
                  batchNo: canonical.batchNo,
                },
              },
            },
          });
          if (ledgerOperations.length >= 1000) await flushLedgerOperations();
        }
      }
    }

    const currentOnHand = new Map();
    const reservations = new Map();
    const snapshotCounts = new Map();
    let snapshotRows = 0;
    let snapshotMetadataChanges = 0;
    for await (const row of snapshots.find({})) {
      snapshotRows += 1;
      const item = itemById.get(String(row.itemId));
      if (!item) {
        blockers.orphanSnapshotRows.push(row._id);
        continue;
      }
      if (
        !item.companyId ||
        !VALID_CATEGORY_KEYS.has(item.categoryKey) ||
        !normalizeUom(item.UOM)
      ) {
        blockers.invalidItems.push({
          itemId: item._id,
          name: item.name,
          source: 'snapshot',
        });
        continue;
      }
      if (String(row.companyId) !== String(item.companyId)) {
        blockers.companyMismatches.push({
          rowId: row._id,
          itemId: item._id,
          inventoryCompanyId: row.companyId,
          itemCompanyId: item.companyId,
        });
        continue;
      }
      const warehouse = warehouseById.get(String(row.warehouseId));
      if (!warehouse || String(warehouse.companyId) !== String(row.companyId)) {
        blockers.warehouseMismatches.push({
          rowId: row._id,
          warehouseId: row.warehouseId,
          companyId: row.companyId,
          source: 'snapshot',
        });
        continue;
      }

      const canonical = {
        companyId: item.companyId,
        itemId: item._id,
        categoryKey: item.categoryKey,
        productType: item.productType || null,
        warehouseId: row.warehouseId,
        bin: normalizeOptional(row.bin),
        batchNo: normalizeOptional(row.batchNo),
        uom: normalizeUom(item.UOM),
      };
      const key = bucketKey(canonical);
      addToMap(currentOnHand, key, row.onHand);
      addToMap(reservations, key, row.reserved);
      snapshotCounts.set(key, (snapshotCounts.get(key) || 0) + 1);
      if (!canonicalBuckets.has(key)) {
        canonicalBuckets.set(key, { ...canonical, onHand: 0, reserved: 0 });
      }

      if (
        row.categoryKey !== canonical.categoryKey ||
        String(row.productType || '') !== String(canonical.productType || '') ||
        normalizeUom(row.uom) !== canonical.uom ||
        row.bin !== canonical.bin ||
        row.batchNo !== canonical.batchNo ||
        !sameNumber(row.available, Number(row.onHand || 0) - Number(row.reserved || 0))
      ) {
        snapshotMetadataChanges += 1;
      }
    }

    const balanceDrift = [];
    for (const [key, onHand] of currentOnHand) {
      if (!ledgerTotals.has(key) && Math.abs(onHand) > EPSILON) {
        blockers.unledgeredSnapshotBalances.push({
          bucket: JSON.parse(key),
          snapshotOnHand: onHand,
        });
      }
    }
    for (const [key, bucket] of canonicalBuckets) {
      bucket.onHand = ledgerTotals.get(key) || 0;
      bucket.reserved = reservations.get(key) || 0;
      const oldOnHand = currentOnHand.get(key) || 0;
      if (!sameNumber(oldOnHand, bucket.onHand)) {
        balanceDrift.push({
          bucket: JSON.parse(key),
          snapshotOnHand: oldOnHand,
          ledgerOnHand: bucket.onHand,
        });
      }
      if (bucket.onHand < -EPSILON) {
        blockers.negativeBuckets.push({
          bucket: JSON.parse(key),
          onHand: bucket.onHand,
        });
      }
      if (bucket.reserved < -EPSILON || bucket.reserved - bucket.onHand > EPSILON) {
        blockers.overReservedBuckets.push({
          bucket: JSON.parse(key),
          onHand: bucket.onHand,
          reserved: bucket.reserved,
        });
      }
    }

    const duplicateCanonicalSnapshotBuckets = [...snapshotCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ bucket: JSON.parse(key), count }));

    const idempotencyDuplicates = await ledgers.aggregate([
      { $match: { idempotencyKey: { $type: 'string' } } },
      {
        $group: {
          _id: {
            companyId: '$companyId',
            idempotencyKey: '$idempotencyKey',
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    blockers.duplicateIdempotencyKeys = idempotencyDuplicates;

    const ledgerItemIds = new Set(
      [...ledgerTotals.keys()].map(key => JSON.parse(key)[1])
    );
    const legacyCurrentStockOnly = itemDocs
      .filter(item => Number(item.currentStock || 0) !== 0)
      .filter(item => !ledgerItemIds.has(String(item._id)))
      .map(item => ({
        itemId: item._id,
        name: item.name,
        currentStock: item.currentStock,
      }));
    blockers.legacyCurrentStockOnly = legacyCurrentStockOnly;

    const blockerCount = Object.values(blockers)
      .reduce((total, values) => total + values.length, 0);
    const plannedChanges = (
      ledgerUpdates +
      snapshotMetadataChanges +
      warehouseUpdates.length +
      duplicateCanonicalSnapshotBuckets.length +
      balanceDrift.length
    );
    const report = {
      mode: applyChanges ? 'apply' : 'audit',
      ledgerRows,
      snapshotRows,
      canonicalSnapshotBuckets: canonicalBuckets.size,
      plannedLedgerMetadataUpdates: ledgerUpdates,
      plannedSnapshotMetadataRepairs: snapshotMetadataChanges,
      plannedWarehouseUpdates: warehouseUpdates.length,
      duplicateCanonicalSnapshotBuckets,
      balanceDrift,
      legacyCurrentStockOnly,
      blockers,
    };
    console.log(JSON.stringify(report, null, 2));

    if (!applyChanges) {
      console.log(
        blockerCount
          ? 'Audit found blockers. Resolve them before applying the migration.'
          : plannedChanges
            ? 'Audit complete. Run migrate:inventory-items to apply the verified repair.'
            : 'Audit complete. Inventory data is already canonical and balanced.'
      );
      process.exitCode = blockerCount ? 2 : 0;
      return report;
    }
    if (blockerCount) {
      throw new Error(
        `Inventory migration stopped because ${blockerCount} blocking issue(s) were found`
      );
    }
    if (warehouseUpdates.length) {
      await warehouses.bulkWrite(warehouseUpdates, { ordered: false });
    }
    await flushLedgerOperations();

    const needsSnapshotRebuild = (
      snapshotMetadataChanges > 0 ||
      duplicateCanonicalSnapshotBuckets.length > 0 ||
      balanceDrift.length > 0
    );
    const backupCollectionName = needsSnapshotRebuild
      ? `inventorysnapshots_backup_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
      : null;
    if (needsSnapshotRebuild) {
      await replaceSnapshots({
        snapshots,
        canonicalBuckets,
        backupCollectionName,
      });
    }

    const snapshotIndexes = await snapshots.indexes();
    const existingBucketIndex = snapshotIndexes.find(index => index.name === 'uniq_bucket');
    const desiredBucketIndex = {
      companyId: 1,
      itemId: 1,
      warehouseId: 1,
      bin: 1,
      batchNo: 1,
      uom: 1,
    };
    if (
      existingBucketIndex &&
      JSON.stringify(existingBucketIndex.key) !== JSON.stringify(desiredBucketIndex)
    ) {
      await snapshots.dropIndex(existingBucketIndex.name);
    }
    if (
      !existingBucketIndex ||
      JSON.stringify(existingBucketIndex.key) !== JSON.stringify(desiredBucketIndex)
    ) {
      await snapshots.createIndex(
        desiredBucketIndex,
        { unique: true, name: 'uniq_bucket' },
      );
    }

    const ledgerIndexes = await ledgers.indexes();
    if (!ledgerIndexes.some(index => index.name === 'uniq_inventory_idempotency')) {
      await ledgers.createIndex(
        { companyId: 1, idempotencyKey: 1 },
        {
          unique: true,
          name: 'uniq_inventory_idempotency',
          partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        },
      );
    }

    const reservationEvents = db.collection('inventoryreservationevents');
    await reservationEvents.createIndex(
      { companyId: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: 'uniq_inventory_reservation_idempotency',
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
    );

    // Search-path indexes used when human specification values are resolved to
    // Item IDs before reading the stock/ledger collections.
    await Promise.all([
      items.createIndex(
        { companyId: 1, productType: 1 },
        { name: 'companyId_1_productType_1' },
      ),
      items.createIndex(
        { companyId: 1, temperature: 1 },
        { name: 'companyId_1_temperature_1' },
      ),
      items.createIndex(
        { companyId: 1, density: 1 },
        { name: 'companyId_1_density_1' },
      ),
      items.createIndex(
        { companyId: 1, dimension: 1 },
        { name: 'companyId_1_dimension_1' },
      ),
      items.createIndex(
        { companyId: 1, packing: 1 },
        { name: 'companyId_1_packing_1' },
      ),
      db.collection('temperatures').createIndex(
        { value: 1 },
        { name: 'value_1' },
      ),
      snapshots.createIndex(
        { companyId: 1, categoryKey: 1, available: -1 },
        { name: 'companyId_1_categoryKey_1_available_-1' },
      ),
      snapshots.createIndex(
        { companyId: 1, productType: 1, available: -1 },
        { name: 'companyId_1_productType_1_available_-1' },
      ),
      ledgers.createIndex(
        { companyId: 1, productType: 1, at: -1 },
        { name: 'companyId_1_productType_1_at_-1' },
      ),
    ]);

    const warehouseIndexes = await warehouses.indexes();
    for (const index of warehouseIndexes) {
      if (
        index.unique &&
        JSON.stringify(index.key) === JSON.stringify({ code: 1 })
      ) {
        await warehouses.dropIndex(index.name);
      }
    }
    if (!warehouseIndexes.some(index => index.name === 'uniq_company_warehouse_code')) {
      await warehouses.createIndex(
        { companyId: 1, code: 1 },
        { unique: true, name: 'uniq_company_warehouse_code' },
      );
    }

    console.log(
      backupCollectionName
        ? `Inventory migration completed. Snapshot backup: ${backupCollectionName}`
        : plannedChanges
          ? 'Inventory migration completed; no snapshot rebuild was required.'
          : 'Inventory migration already applied; indexes verified.'
    );
    return { ...report, backupCollectionName };
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrateInventoryItemMetadata();
}
