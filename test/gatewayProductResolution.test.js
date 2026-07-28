import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryKeyFromName,
  inventoryCategoryForStatus,
  inventoryQuantityForGatewayRecord,
  shouldPostGatewayInventory,
} from '../services/gatewayProductionService.js';

test('maps controlled Category names to Item category keys', () => {
  assert.equal(categoryKeyFromName('Finished Goods'), 'FG');
  assert.equal(categoryKeyFromName('non-conformance'), 'NC');
  assert.equal(categoryKeyFromName('raw material'), 'RAW');
  assert.equal(categoryKeyFromName('packing material'), 'PACKING');
});

test('routes gateway output using one ProductType category', () => {
  assert.deepEqual(
    inventoryCategoryForStatus(
      { id: 'fg-id', name: 'finished goods' },
      true,
    ),
    { id: 'fg-id', name: 'finished goods', key: 'FG' },
  );
  assert.equal(
    inventoryCategoryForStatus(
      { id: 'fg-id', name: 'finished goods' },
      false,
    ),
    null,
  );
  assert.deepEqual(
    inventoryCategoryForStatus(
      { id: 'nc-id', name: 'non-conformance' },
      false,
    ),
    { id: 'nc-id', name: 'non-conformance', key: 'NC' },
  );
});

test('ET remains inventory-eligible while rejected FG-only output does not', () => {
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 5,
      statusOk: false,
      weightKg: 12.5,
      targetCategory: null,
    }),
    true,
  );
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 1,
      statusOk: false,
      weightKg: 12.5,
      targetCategory: { id: 'fg-id', name: 'finished goods', key: 'FG' },
    }),
    false,
  );
  assert.equal(
    shouldPostGatewayInventory({
      productCode: 1,
      statusOk: false,
      weightKg: 12.5,
      targetCategory: { id: 'nc-id', name: 'non-conformance', key: 'NC' },
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
