import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  ITEM_ATTRIBUTE_CATALOG,
  ITEM_CLASS_CATALOG,
  ITEM_FAMILY_CATALOG,
} from '../config/itemMasterCatalog.js';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryCostBalance from '../models/InventoryCostBalance.js';
import InventoryLot from '../models/InventoryLot.js';
import InventorySerial from '../models/InventorySerial.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import ItemAttributeDefinition from '../models/ItemAttributeDefinition.js';
import ItemClass from '../models/ItemClass.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import ManufacturingRecipe from '../models/ManufacturingRecipe.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import ProductionOrder from '../models/ProductionOrder.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('MONGO_URI or MONGODB_URI is required');
  process.exit(1);
}

const collectionRenames = Object.freeze({
  inventorybalancev2: 'inventorybalances',
  inventorylotv2: 'inventorylots',
  inventoryserialv2: 'inventoryserials',
  inventorytransactionv2: 'inventorytransactions',
  manufacturingrecipev2: 'manufacturingrecipes',
  productionorderv2: 'productionorders',
});

const retiredCollections = Object.freeze([
  'items',
  'categories',
  'producttypes',
  'temperatures',
  'densities',
  'dimensions',
  'rawmaterials',
  'packingmaterials',
  'products',
  'boms',
  'inventorymoves',
  'inventoryledgers',
  'inventorysnapshots',
  'inventoryreservationevents',
  'batches',
  'gatewaycodemaps',
]);

const managedModels = Object.freeze([
  ItemClass,
  ItemAttributeDefinition,
  ItemFamily,
  ItemMaster,
  InventoryBalance,
  InventoryCostBalance,
  InventoryLot,
  InventorySerial,
  InventoryTransaction,
  ManufacturingRecipe,
  ProductionOrder,
  ProductionBlanketRoll,
]);

const capabilities = source => ({
  inventory: source?.inventory ?? true,
  purchasable: source?.purchasable ?? false,
  manufacturable: source?.manufacturable ?? false,
  consumable: source?.consumable ?? false,
  sellable: source?.sellable ?? false,
});

async function existingCollectionNames(db) {
  return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
}

async function seedSystemCatalog(db, companyIds, result) {
  const classes = db.collection('itemclasses');
  const attributes = db.collection('itemattributedefinitions');
  const families = db.collection('itemfamilies');
  const now = new Date();

  for (const companyId of companyIds) {
    const classWrite = await classes.bulkWrite(
      ITEM_CLASS_CATALOG.map(entry => ({
        updateOne: {
          filter: { companyId, code: entry.code },
          update: {
            $set: {
              name: entry.name,
              description: entry.description || '',
              capabilities: capabilities(entry.capabilities),
              system: true,
              status: 'active',
              updatedAt: now,
            },
            $setOnInsert: { companyId, createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );

    const attributeWrite = await attributes.bulkWrite(
      ITEM_ATTRIBUTE_CATALOG.map(entry => ({
        updateOne: {
          filter: { companyId, code: entry.code },
          update: {
            $set: {
              label: entry.label,
              description: entry.description || '',
              dataType: entry.dataType,
              unit: entry.unit || null,
              referenceModel: entry.referenceModel || null,
              referenceFamilyCode: entry.referenceFamilyCode || null,
              allowedValues: (entry.allowedValues || []).map((option, index) => ({
                value: option.value,
                label: option.label,
                sortOrder: option.sortOrder ?? index,
                active: true,
              })),
              validation: {
                min: entry.validation?.min ?? null,
                max: entry.validation?.max ?? null,
                precision: entry.validation?.precision ?? null,
                pattern: entry.validation?.pattern ?? null,
                maxLength: entry.validation?.maxLength ?? null,
              },
              system: true,
              status: 'active',
              updatedAt: now,
            },
            $setOnInsert: { companyId, createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );

    const [classRows, attributeRows] = await Promise.all([
      classes.find({ companyId }).toArray(),
      attributes.find({ companyId }).toArray(),
    ]);
    const classByCode = new Map(classRows.map(row => [row.code, row]));
    const attributeByCode = new Map(attributeRows.map(row => [row.code, row]));

    const familyWrite = await families.bulkWrite(
      ITEM_FAMILY_CATALOG.map(entry => {
        const itemClass = classByCode.get(entry.classCode);
        if (!itemClass) throw new Error(`Item Class ${entry.classCode} was not seeded`);
        const attributeRules = entry.attributes.map((rule, index) => {
          const attribute = attributeByCode.get(rule.attributeCode);
          if (!attribute) throw new Error(`Item attribute ${rule.attributeCode} was not seeded`);
          return {
            attributeId: attribute._id,
            required: rule.required,
            identity: rule.identity,
            searchable: true,
            displayOrder: index,
            defaultValue: null,
          };
        });
        return {
          updateOne: {
            filter: { companyId, code: entry.code },
            update: {
              $set: {
                itemClassId: itemClass._id,
                name: entry.name,
                description: entry.description || '',
                capabilities: capabilities(itemClass.capabilities),
                attributeRules,
                uomPolicy: {
                  baseUom: entry.uomPolicy.baseUom,
                  catchUom: entry.uomPolicy.catchUom || null,
                  catchMode: entry.uomPolicy.catchMode || 'NONE',
                  nominalFactor: entry.uomPolicy.nominalFactor ?? null,
                },
                trackingPolicy: {
                  lotTracked: entry.trackingPolicy?.lotTracked ?? true,
                  serialTracked: entry.trackingPolicy?.serialTracked ?? false,
                  serialControlMode: entry.trackingPolicy?.serialControlMode
                    || (entry.trackingPolicy?.serialTracked ? 'INFORMATIONAL' : 'NONE'),
                  expiryTracked: entry.trackingPolicy?.expiryTracked ?? false,
                },
                skuPrefix: entry.skuPrefix,
                status: 'active',
                updatedAt: now,
              },
              $setOnInsert: { companyId, version: 1, createdAt: now },
            },
            upsert: true,
          },
        };
      }),
      { ordered: true },
    );

    result.catalog.classes += classWrite.upsertedCount + classWrite.modifiedCount;
    result.catalog.attributes += attributeWrite.upsertedCount + attributeWrite.modifiedCount;
    result.catalog.families += familyWrite.upsertedCount + familyWrite.modifiedCount;
  }
}

async function migrateGatewayLinks(db, names, result) {
  if (!names.has('productionblanketrolls')) return;
  const rolls = db.collection('productionblanketrolls');
  const gatewayFieldMap = {
    inventoryPosted: 'inventoryV2Posted',
    inventoryStatus: 'inventoryV2Status',
    inventoryLastError: 'inventoryV2LastError',
    inventoryLastAttemptAt: 'inventoryV2LastAttemptAt',
    itemId: 'inventoryV2ItemId',
    inventoryTransactionId: 'inventoryV2TransactionId',
    inventorySerialId: 'inventoryV2SerialId',
    inventorySerialNo: 'inventoryV2SerialNo',
  };
  const retiredFields = [
    ...Object.values(gatewayFieldMap),
    'productType',
    'temperature',
    'density',
    'dimension',
    'packingItem',
    'matchedItem',
    'itemCategory',
    'itemCategoryKey',
    'resolveErrors',
    'inventoryRef',
  ];
  result.gateway.records = await rolls.estimatedDocumentCount();
  result.gateway.previousFields = await rolls.countDocuments({
    $or: Object.values(gatewayFieldMap).map(field => ({ [field]: { $exists: true } })),
  });
  if (!apply) return;

  const setFields = Object.fromEntries(
    Object.entries(gatewayFieldMap).map(([target, source]) => [
      target,
      { $ifNull: [`$${source}`, { $ifNull: [`$${target}`, null] }] },
    ]),
  );
  setFields.inventoryPosted = {
    $ifNull: ['$inventoryV2Posted', { $ifNull: ['$inventoryPosted', false] }],
  };
  setFields.inventoryStatus = {
    $ifNull: ['$inventoryV2Status', { $ifNull: ['$inventoryStatus', 'PENDING_MAPPING'] }],
  };
  await rolls.updateMany({}, [{ $set: setFields }]);
  await rolls.updateMany(
    { inventoryStatus: 'PENDING' },
    { $set: { inventoryStatus: 'PENDING_MAPPING' } },
  );
  await rolls.updateMany({}, {
    $unset: Object.fromEntries(retiredFields.map(field => [field, ''])),
  });
  result.gateway.migrated = result.gateway.previousFields;
}

async function removeObsoleteIndexes(db, collectionNames, result) {
  for (const collectionName of collectionNames) {
    const indexes = await db.collection(collectionName).listIndexes().toArray().catch(() => []);
    for (const index of indexes) {
      if (index.name !== '_id_' && /v2/i.test(index.name)) {
        await db.collection(collectionName).dropIndex(index.name);
        result.droppedIndexes.push(`${collectionName}.${index.name}`);
      }
    }
  }
}

await mongoose.connect(mongoUri, { autoIndex: false });

try {
  const db = mongoose.connection.db;
  let names = await existingCollectionNames(db);
  const result = {
    mode: apply ? 'APPLY' : 'AUDIT',
    renamedCollections: [],
    replacedCollections: [],
    retiredCollections: [],
    retiredBackupCollections: [],
    droppedIndexes: [],
    catalog: { companies: 0, classes: 0, attributes: 0, families: 0 },
    gateway: { records: 0, previousFields: 0, migrated: 0 },
    gatewayIdempotencyKeys: { previous: 0, migrated: 0 },
    fieldCleanup: { itemMasters: 0, inventorySerials: 0 },
    indexesSynchronized: [],
  };

  for (const [source, target] of Object.entries(collectionRenames)) {
    if (!names.has(source)) continue;
    if (apply && names.has(target)) {
      await db.collection(target).drop();
      result.replacedCollections.push(target);
      names.delete(target);
    }
    if (apply) {
      await db.collection(source).rename(target);
      names.delete(source);
      names.add(target);
    }
    result.renamedCollections.push({ from: source, to: target });
  }

  names = await existingCollectionNames(db);
  await migrateGatewayLinks(db, names, result);

  if (names.has('inventorytransactions')) {
    const transactions = db.collection('inventorytransactions');
    result.gatewayIdempotencyKeys.previous = await transactions.countDocuments({
      idempotencyKey: /^PROD_GATEWAY_V2:/,
    });
    if (apply && result.gatewayIdempotencyKeys.previous) {
      const keyWrite = await transactions.updateMany(
        { idempotencyKey: /^PROD_GATEWAY_V2:/ },
        [{
          $set: {
            idempotencyKey: {
              $concat: [
                'PROD_GATEWAY:',
                { $substrCP: ['$idempotencyKey', 16, { $strLenCP: '$idempotencyKey' }] },
              ],
            },
          },
        }],
      );
      result.gatewayIdempotencyKeys.migrated = keyWrite.modifiedCount;
    }
  }

  if (names.has('itemmasters')) {
    result.fieldCleanup.itemMasters = await db.collection('itemmasters').countDocuments({
      $or: [{ legacyItemId: { $exists: true } }, { schemaVersion: { $exists: true } }],
    });
    if (apply) {
      await db.collection('itemmasters').updateMany({}, {
        $unset: { legacyItemId: '', schemaVersion: '' },
      });
    }
  }
  if (names.has('inventoryserials')) {
    result.fieldCleanup.inventorySerials = await db.collection('inventoryserials').countDocuments({
      legacySerialNo: { $exists: true },
    });
    if (apply) {
      await db.collection('inventoryserials').updateMany({}, {
        $unset: { legacySerialNo: '' },
      });
    }
  }

  const backupCollections = [...names].filter(name => name.startsWith('inventorysnapshots_backup_'));
  for (const collectionName of [...retiredCollections, ...backupCollections]) {
    if (!names.has(collectionName)) continue;
    if (apply) await db.collection(collectionName).drop();
    if (backupCollections.includes(collectionName)) {
      result.retiredBackupCollections.push(collectionName);
    } else {
      result.retiredCollections.push(collectionName);
    }
  }

  const companyIds = (await db.collection('companies').find({}, { projection: { _id: 1 } }).toArray())
    .map(company => company._id);
  result.catalog.companies = companyIds.length;
  if (apply && companyIds.length) await seedSystemCatalog(db, companyIds, result);

  if (apply) {
    const managedCollectionNames = [...new Set(
      managedModels.map(model => model.collection.collectionName),
    )];
    await removeObsoleteIndexes(db, managedCollectionNames, result);
    for (const model of managedModels) {
      await model.syncIndexes();
      result.indexesSynchronized.push(model.collection.collectionName);
    }
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
