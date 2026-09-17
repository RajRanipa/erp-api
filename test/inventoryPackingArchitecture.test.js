import assert from 'node:assert/strict';
import test from 'node:test';
import InventoryLotV2 from '../models/InventoryLotV2.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';

test('Inventory V2 lots retain packing identity and consumed components', () => {
  assert.ok(InventoryLotV2.schema.path('packingLabel'));
  assert.ok(InventoryLotV2.schema.path('packingKey'));
  assert.ok(InventoryLotV2.schema.path('packagingComponents'));
  const componentSchema = InventoryLotV2.schema.path('packagingComponents').schema;
  assert.ok(componentSchema.path('itemId'));
  assert.ok(componentSchema.path('quantity'));
  assert.ok(componentSchema.path('uom'));
});

test('controlled adjustments retain explicit approval and audit fields', () => {
  assert.ok(InventoryTransactionV2.schema.path('reason'));
  assert.ok(InventoryTransactionV2.schema.path('authorizationReference'));
  assert.ok(InventoryTransactionV2.schema.path('createdBy'));
  assert.ok(InventoryTransactionV2.schema.path('referenceId'));
});
