import assert from 'node:assert/strict';
import test from 'node:test';
import Campaign from '../models/Campaign.js';
import InventoryLot from '../models/InventoryLot.js';
import InventorySerial from '../models/InventorySerial.js';
import {
  generateInventorySerial,
  generateInventorySerialBatch,
  INVENTORY_SERIAL_DIGITS,
  isValidInventorySerial,
  luhnCheckDigit,
} from '../utils/serialNumber.js';
import {
  shouldCreateTraceSerials,
  validateManualSerializedUnits,
} from '../services/inventoryService.js';

test('inventory serial generator creates numeric, checkable, fixed-length identifiers', () => {
  const serial = generateInventorySerial();
  assert.match(serial, /^\d{16}$/);
  assert.equal(serial.length, INVENTORY_SERIAL_DIGITS);
  assert.equal(isValidInventorySerial(serial), true);
  assert.equal(luhnCheckDigit(serial.slice(0, -1)), serial.slice(-1));
  assert.equal(isValidInventorySerial(`${serial.slice(0, -1)}${(Number(serial.at(-1)) + 1) % 10}`), false);
});

test('serial batches are unique inside a high-volume receipt', () => {
  const serials = generateInventorySerialBatch(1000);
  assert.equal(serials.length, 1000);
  assert.equal(new Set(serials).size, 1000);
  assert.equal(serials.every(isValidInventorySerial), true);
});

test('serial trace schema stores production and immutable public context', () => {
  for (const path of [
    'campaignId',
    'manufacturedAt',
    'measuredAt',
    'manualReason',
    'traceSnapshot',
  ]) {
    assert.ok(InventorySerial.schema.path(path), `missing ${path}`);
  }
  assert.ok(InventoryLot.schema.path('campaignId'));
  assert.ok(Campaign.schema.path('companyId'));
  const globalSerialIndex = InventorySerial.schema.indexes().find(
    ([keys, options]) => keys.serialNo === 1 && options.unique,
  );
  assert.ok(globalSerialIndex, 'serialNo must have a global unique index');
});

test('invalid serial batch sizes are rejected', () => {
  assert.throws(() => generateInventorySerialBatch(0), RangeError);
  assert.throws(() => generateInventorySerialBatch(1001), RangeError);
  assert.throws(() => generateInventorySerialBatch(1.5), RangeError);
});

test('manual serialized receipts require exactly one weight row per unit', () => {
  assert.equal(validateManualSerializedUnits(2, [{ catchQuantity: 10 }, { catchQuantity: 11 }], 'roll'), true);
  assert.throws(
    () => validateManualSerializedUnits(2, [{ catchQuantity: 10 }], 'roll'),
    error => error.code === 'SERIAL_QUANTITY_MISMATCH'
      && error.details.expected === 2
      && error.details.received === 1,
  );
  assert.throws(
    () => validateManualSerializedUnits(2, [
      { catchQuantity: 10 },
      { catchQuantity: 11 },
      { catchQuantity: 12 },
    ], 'roll'),
    error => error.code === 'SERIAL_QUANTITY_MISMATCH'
      && error.details.received === 3,
  );
});

test('serials are created only for manufacturing receipts, never technical transactions', () => {
  const item = { trackingPolicy: { serialTracked: true } };
  assert.equal(shouldCreateTraceSerials(item, 'PROD_GATEWAY'), true);
  assert.equal(shouldCreateTraceSerials(item, 'MANUAL_RECEIPT'), true);
  for (const sourceType of ['CONVERSION', 'TRANSFER', 'BLANKET_PACKING', 'SALE', 'ISSUE']) {
    assert.equal(shouldCreateTraceSerials(item, sourceType), false, sourceType);
  }
  assert.equal(shouldCreateTraceSerials(item, 'PROD_GATEWAY', true), false);
  assert.equal(shouldCreateTraceSerials({ trackingPolicy: {} }, 'PROD_GATEWAY'), false);
});
