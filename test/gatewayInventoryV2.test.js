import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGatewayInventoryV2ReceiptInput,
  gatewayV2IdentityForRecord,
  gatewayV2QuantityForItem,
  shouldAutoPackGatewayReceipt,
} from '../services/gatewayInventoryV2Service.js';

const baseRecord = {
  companyId: 'company-1',
  warehouseId: 'warehouse-1',
  gatewayId: 'pi-gateway-1',
  recordId: 'record-1',
  scaleNo: 1,
  weightKg: 14.2,
  statusOk: true,
  productCode: 1,
  batchNo: 'Batch Aug 26',
  productionId: 'production-1',
  campaignId: 'campaign-1',
  at: '2026-08-02T06:08:00.000Z',
};

test('gateway maps PLC Blanket specifications to Item Master V2 identity', () => {
  assert.deepEqual(gatewayV2IdentityForRecord({
    productCode: 1,
    temperatureValue: 1260,
    densityValue: 128,
    sizeCode: 4,
  }), {
    familyCode: 'BLANKET',
    attributes: [
      { code: 'classification_temperature', normalizedValue: '1260' },
      { code: 'density', normalizedValue: '128' },
      { code: 'length', normalizedValue: '7620' },
      { code: 'width', normalizedValue: '610' },
      { code: 'thickness', normalizedValue: '25' },
    ],
  });
});

test('gateway supports direct new-system identities for Bulk, Module and ET', () => {
  assert.deepEqual(gatewayV2IdentityForRecord({
    productCode: 2,
    temperatureValue: 1260,
  }), {
    familyCode: 'BULK',
    attributes: [{ code: 'classification_temperature', normalizedValue: '1260' }],
  });
  assert.equal(gatewayV2IdentityForRecord({
    productCode: 4,
    temperatureValue: 1260,
    densityValue: 220,
    sizeCode: 2,
  }).familyCode, 'MODULE');
  assert.deepEqual(gatewayV2IdentityForRecord({
    productCode: 5,
    temperatureValue: 1260,
  }), {
    familyCode: 'ET',
    attributes: [{ code: 'classification_temperature', normalizedValue: '1260' }],
  });
});

test('gateway rejects an unknown Blanket size before inventory posting', () => {
  assert.throws(
    () => gatewayV2IdentityForRecord({
      productCode: 1,
      temperatureValue: 1260,
      densityValue: 128,
      sizeCode: 99,
    }),
    error => error?.code === 'INVALID_SIZE_CODE',
  );
});

test('gateway builds one traceable Blanket receipt with authoritative PLC weight', () => {
  const input = buildGatewayInventoryV2ReceiptInput({
    ...baseRecord,
    item: {
      _id: 'blanket-item',
      baseUom: 'roll',
      catchUom: 'kg',
      trackingPolicy: { serialTracked: true },
    },
  });
  assert.equal(input.quantity, 1);
  assert.equal(input.catchQuantity, 14.2);
  assert.equal(input.lotNo, 'BATCH-AUG-26-OK');
  assert.equal(input.sourceType, 'PROD_GATEWAY');
  assert.equal(input.receiptMode, 'PRODUCTION');
  assert.deepEqual(input.units, [{
    catchQuantity: 14.2,
    catchSource: 'PLC_PI',
    manufacturedAt: new Date(baseRecord.at),
    measuredAt: new Date(baseRecord.at),
  }]);
});

test('gateway uses weight as ET quantity and does not create an ET serial', () => {
  const input = buildGatewayInventoryV2ReceiptInput({
    ...baseRecord,
    productCode: 5,
    statusOk: false,
    weightKg: 3.25,
    item: {
      _id: 'et-item',
      baseUom: 'kg',
      catchUom: null,
      trackingPolicy: { serialTracked: false },
    },
  });
  assert.equal(input.quantity, 3.25);
  assert.equal(input.catchQuantity, undefined);
  assert.equal(input.qualityStatus, 'AVAILABLE');
  assert.equal(input.units, undefined);
});

test('gateway records measured Bulk bag weight as catch quantity', () => {
  const item = {
    _id: 'bulk-item',
    baseUom: 'bag',
    catchUom: 'kg',
    trackingPolicy: { serialTracked: false },
  };
  assert.equal(gatewayV2QuantityForItem(19.8, item), 1);
  const input = buildGatewayInventoryV2ReceiptInput({
    ...baseRecord,
    productCode: 2,
    weightKg: 19.8,
    item,
  });
  assert.equal(input.quantity, 1);
  assert.equal(input.catchQuantity, 19.8);
  assert.equal(input.units, undefined);
});

test('only accepted gateway Blankets are automatically plastic packed', () => {
  assert.equal(shouldAutoPackGatewayReceipt('BLANKET', { qualityStatus: 'AVAILABLE' }), true);
  assert.equal(shouldAutoPackGatewayReceipt('BLANKET', { qualityStatus: 'REJECTED' }), false);
  assert.equal(shouldAutoPackGatewayReceipt('BULK', { qualityStatus: 'AVAILABLE' }), false);
});
