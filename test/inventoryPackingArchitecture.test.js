import assert from 'node:assert/strict';
import test from 'node:test';
import InventoryLot from '../models/InventoryLot.js';
import InventoryTransaction from '../models/InventoryTransaction.js';

test('Inventory lots retain packing identity and consumed components', () => {
  assert.ok(InventoryLot.schema.path('packingLabel'));
  assert.ok(InventoryLot.schema.path('packingKey'));
  assert.ok(InventoryLot.schema.path('packagingComponents'));
  const componentSchema = InventoryLot.schema.path('packagingComponents').schema;
  assert.ok(componentSchema.path('itemId'));
  assert.ok(componentSchema.path('quantity'));
  assert.ok(componentSchema.path('uom'));
});

test('controlled adjustments retain explicit approval and audit fields', () => {
  assert.ok(InventoryTransaction.schema.path('reason'));
  assert.ok(InventoryTransaction.schema.path('authorizationReference'));
  assert.ok(InventoryTransaction.schema.path('createdBy'));
  assert.ok(InventoryTransaction.schema.path('referenceId'));
});
