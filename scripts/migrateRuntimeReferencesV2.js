import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ItemMaster from '../models/ItemMaster.js';
import { resolveGatewayItemV2 } from '../services/gatewayInventoryV2Service.js';
import { resolveLegacyItemReference } from '../services/legacyReferenceResolver.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const companyArg = process.argv.find(argument => argument.startsWith('--company='))
  ?.split('=')[1];
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}
if (companyArg && !mongoose.isValidObjectId(companyArg)) {
  console.error('--company must be a valid ObjectId');
  process.exit(1);
}

const normalized = value => String(value || '').trim().toLowerCase();
const companyFilter = companyArg
  ? { companyId: new mongoose.Types.ObjectId(companyArg) }
  : {};

await mongoose.connect(mongoUri, { autoIndex: false });
try {
  const masters = await ItemMaster.find(companyFilter)
    .select('_id companyId legacyItemId sku name status capabilities')
    .lean();
  const mastersByCompany = new Map();
  for (const item of masters) {
    const companyKey = String(item.companyId);
    if (!mastersByCompany.has(companyKey)) {
      mastersByCompany.set(companyKey, {
        ids: new Set(),
        sku: new Map(),
        name: new Map(),
      });
    }
    const index = mastersByCompany.get(companyKey);
    index.ids.add(String(item._id));
    index.sku.set(normalized(item.sku), item);
    const name = normalized(item.name);
    const names = index.name.get(name) || [];
    names.push(item);
    index.name.set(name, names);
  }

  const blockerMap = new Map();
  const addBlocker = (scope, identity, reason, example = null) => {
    const key = `${scope}:${identity}:${reason}`;
    const current = blockerMap.get(key) || {
      scope,
      identity,
      reason,
      count: 0,
      examples: [],
    };
    current.count += 1;
    if (example && current.examples.length < 5) current.examples.push(example);
    blockerMap.set(key, current);
  };
  const result = {
    mode: apply ? 'APPLY' : 'AUDIT',
    itemMasters: masters.length,
    procurementDocumentsScanned: 0,
    procurementReferencesPlanned: 0,
    procurementDocumentsUpdated: 0,
    productionGroupsScanned: 0,
    productionRecordsPlanned: 0,
    productionRecordsUpdated: 0,
    productionRecordsNotApplicable: 0,
    blockers: [],
  };

  async function resolveEmbeddedItem(document, row) {
    const index = mastersByCompany.get(String(document.companyId));
    if (!row?.itemId || !index) return null;
    if (index.ids.has(String(row.itemId))) return { itemId: row.itemId, alreadyV2: true };
    const recovered = await resolveLegacyItemReference(document.companyId, row.itemId);
    if (recovered.item) return { itemId: recovered.item._id, source: recovered.source };
    const bySku = index.sku.get(normalized(row.sku));
    if (bySku) return { itemId: bySku._id, source: 'SNAPSHOT_SKU' };
    const byName = index.name.get(normalized(row.itemName));
    if (byName?.length === 1) return { itemId: byName[0]._id, source: 'SNAPSHOT_NAME' };
    return { itemId: null, reason: recovered.reason || 'No Item Master mapping exists' };
  }

  for (const definition of [
    { name: 'purchaseorders', paths: ['lines'] },
    { name: 'goodsreceipts', paths: ['lines'] },
    { name: 'purchasereturns', paths: ['lines'] },
    { name: 'purchaseinvoices', paths: ['lines', 'variances'] },
  ]) {
    const collection = mongoose.connection.collection(definition.name);
    for await (const document of collection.find(companyFilter)) {
      result.procurementDocumentsScanned += 1;
      const update = {};
      for (const path of definition.paths) {
        const rows = Array.isArray(document[path]) ? document[path] : [];
        const migrated = [];
        for (const row of rows) {
          const resolved = await resolveEmbeddedItem(document, row);
          if (!resolved || resolved.alreadyV2) {
            migrated.push(row);
            continue;
          }
          if (!resolved.itemId) {
            addBlocker(
              `procurement.${definition.name}.${path}`,
              row.sku || row.itemName || row.itemId,
              resolved.reason,
              document._id,
            );
            migrated.push(row);
            continue;
          }
          result.procurementReferencesPlanned += 1;
          migrated.push({ ...row, itemId: resolved.itemId });
        }
        if (migrated.some((row, index) => String(row?.itemId) !== String(rows[index]?.itemId))) {
          update[path] = migrated;
        }
      }
      if (apply && Object.keys(update).length) {
        const written = await collection.updateOne({ _id: document._id }, { $set: update });
        result.procurementDocumentsUpdated += written.modifiedCount;
      }
    }
  }

  const production = mongoose.connection.collection('productionblanketrolls');
  const groups = await production.aggregate([
    {
      $match: {
        ...companyFilter,
        inventoryV2ItemId: null,
      },
    },
    {
      $group: {
        _id: {
          companyId: '$companyId',
          productCode: '$productCode',
          temperatureValue: '$temperatureValue',
          densityValue: '$densityValue',
          sizeCode: '$sizeCode',
        },
        count: { $sum: 1 },
        exampleId: { $first: '$_id' },
      },
    },
  ]).toArray();
  result.productionGroupsScanned = groups.length;
  for (const group of groups) {
    const { companyId, ...specification } = group._id;
    let resolved;
    try {
      resolved = await resolveGatewayItemV2({ companyId, ...specification });
    } catch (error) {
      resolved = { status: 'FAILED', message: error.message, item: null };
    }
    if (resolved.status === 'NOT_APPLICABLE') {
      result.productionRecordsNotApplicable += group.count;
      continue;
    }
    if (!resolved.item) {
      addBlocker(
        'gateway-production',
        `${specification.productCode}:${specification.temperatureValue}:${specification.densityValue}:${specification.sizeCode}`,
        resolved.message || 'No Item Master mapping exists',
        group.exampleId,
      );
      continue;
    }
    result.productionRecordsPlanned += group.count;
    if (apply) {
      const written = await production.updateMany(
        { ...group._id, inventoryV2ItemId: null },
        { $set: { inventoryV2ItemId: resolved.item._id } },
      );
      result.productionRecordsUpdated += written.modifiedCount;
    }
  }
  result.blockers = [...blockerMap.values()];
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
