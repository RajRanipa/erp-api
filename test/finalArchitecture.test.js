import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import InventoryBalance from '../models/InventoryBalance.js';
import InventoryCostBalance from '../models/InventoryCostBalance.js';
import InventoryLot from '../models/InventoryLot.js';
import InventorySerial from '../models/InventorySerial.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import ItemMaster from '../models/ItemMaster.js';
import ManufacturingRecipe from '../models/ManufacturingRecipe.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import ProductionOrder from '../models/ProductionOrder.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

test('final business models use permanent collection names', () => {
  assert.deepEqual({
    balances: InventoryBalance.collection.collectionName,
    costBalances: InventoryCostBalance.collection.collectionName,
    lots: InventoryLot.collection.collectionName,
    serials: InventorySerial.collection.collectionName,
    transactions: InventoryTransaction.collection.collectionName,
    items: ItemMaster.collection.collectionName,
    recipes: ManufacturingRecipe.collection.collectionName,
    productionOrders: ProductionOrder.collection.collectionName,
  }, {
    balances: 'inventorybalances',
    costBalances: 'inventorycostbalances',
    lots: 'inventorylots',
    serials: 'inventoryserials',
    transactions: 'inventorytransactions',
    items: 'itemmasters',
    recipes: 'manufacturingrecipes',
    productionOrders: 'productionorders',
  });
});

test('gateway records expose only final inventory linkage fields', () => {
  for (const field of [
    'inventoryPosted',
    'inventoryStatus',
    'inventoryLastError',
    'inventoryLastAttemptAt',
    'itemId',
    'inventoryTransactionId',
    'inventorySerialId',
    'inventorySerialNo',
  ]) {
    assert.ok(ProductionBlanketRoll.schema.path(field), `${field} must exist`);
  }
  assert.deepEqual(
    ProductionBlanketRoll.schema.path('inventoryStatus').enumValues,
    ['PENDING_MAPPING', 'POSTED', 'FAILED', 'NOT_APPLICABLE'],
  );
});

test('retired item and inventory model files cannot return to runtime', () => {
  const modelsDir = path.resolve(dirname, '../models');
  const retired = [
    'Item.js',
    'Category.js',
    'ProductType.js',
    'Temperature.js',
    'Density.js',
    'Dimension.js',
    'InventorySnapshot.js',
    'InventoryLedger.js',
    'InventoryReservationEvent.js',
    'Batches.js',
    'GatewayCodeMap.js',
  ];
  assert.deepEqual(retired.filter(file => fs.existsSync(path.join(modelsDir, file))), []);
});

test('item and serial schemas do not contain migration-only identity fields', () => {
  assert.equal(ItemMaster.schema.path('legacyItemId'), undefined);
  assert.equal(ItemMaster.schema.path('schemaVersion'), undefined);
  assert.equal(InventorySerial.schema.path('legacySerialNo'), undefined);
});
