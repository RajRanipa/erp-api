import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryKeyFromName,
  inventoryCategoriesForStatus,
  inventoryQuantityForGatewayRecord,
  shouldPostGatewayInventory,
} from '../services/gatewayProductionService.js';

const categories = [
  { id: 'fg-id', name: 'finished goods' },
  { id: 'nc-id', name: 'non-conformance' },
  { id: 'raw-id', name: 'raw material' },
];

test('maps controlled Category names to Item category keys', () => {
  assert.equal(categoryKeyFromName('Finished Goods'), 'FG');
  assert.equal(categoryKeyFromName('non-conformance'), 'NC');
  assert.equal(categoryKeyFromName('raw material'), 'RAW');
  assert.equal(categoryKeyFromName('packing material'), 'PACKING');
});

test('routes accepted and rejected gateway output to compatible categories', () => {
  assert.deepEqual(
    inventoryCategoriesForStatus(categories, true).map(category => category.key),
    ['FG', 'RAW'],
  );
  assert.deepEqual(
    inventoryCategoriesForStatus(categories, false).map(category => category.key),
    ['NC', 'RAW'],
  );
});

test('ET remains inventory-eligible while rejected FG-only output does not', () => {
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 5,
      statusOk: false,
      weightKg: 12.5,
      targetCategories: [],
    }),
    true,
  );
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 1,
      statusOk: false,
      weightKg: 12.5,
      targetCategories: [{ id: 'fg-id', name: 'finished goods', key: 'FG' }],
    }),
    false,
  );
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 1,
      statusOk: false,
      weightKg: 12.5,
      targetCategories: [{ id: 'nc-id', name: 'non-conformance', key: 'NC' }],
    }),
    true,
  );
});

test('converts gateway kilograms using the matched Item UOM', () => {
  assert.equal(inventoryQuantityForGatewayRecord(12.5, 'kg'), 12.5);
  assert.equal(inventoryQuantityForGatewayRecord(12.5, 'g'), 12500);
  assert.equal(inventoryQuantityForGatewayRecord(1500, 'tonne'), 1.5);
  assert.equal(inventoryQuantityForGatewayRecord(12.5, 'roll'), 1);
  assert.throws(
    () => inventoryQuantityForGatewayRecord(12.5, 'litre'),
    error => error?.code === 'GATEWAY_UOM_MISMATCH',
  );
});
