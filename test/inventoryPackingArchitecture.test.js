import assert from 'node:assert/strict';
import test from 'node:test';
import InventoryLotV2 from '../models/InventoryLotV2.js';

test('Inventory V2 lots retain packing identity and consumed components', () => {
  assert.ok(InventoryLotV2.schema.path('packingLabel'));
  assert.ok(InventoryLotV2.schema.path('packingKey'));
  assert.ok(InventoryLotV2.schema.path('packagingComponents'));
  const componentSchema = InventoryLotV2.schema.path('packagingComponents').schema;
  assert.ok(componentSchema.path('itemId'));
  assert.ok(componentSchema.path('quantity'));
  assert.ok(componentSchema.path('uom'));
});
