import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGatewayInventoryReceiptInput,
  gatewayIdentityForRecord,
  gatewayQuantityForItem,
  shouldAutoPackGatewayReceipt,
} from '../services/gatewayInventoryService.js';
import { eligibleGatewayPlasticBagItems } from '../services/inventoryService.js';

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

test('gateway maps PLC Blanket specifications to Item Master identity', () => {
  assert.deepEqual(gatewayIdentityForRecord({
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
  assert.deepEqual(gatewayIdentityForRecord({
    productCode: 2,
    temperatureValue: 1260,
  }), {
    familyCode: 'BULK',
    attributes: [{ code: 'classification_temperature', normalizedValue: '1260' }],
  });
  assert.equal(gatewayIdentityForRecord({
    productCode: 4,
    temperatureValue: 1260,
    densityValue: 220,
    sizeCode: 2,
  }).familyCode, 'MODULE');
  assert.deepEqual(gatewayIdentityForRecord({
    productCode: 5,
    temperatureValue: 1260,
  }), {
    familyCode: 'ET',
    attributes: [{ code: 'classification_temperature', normalizedValue: '1260' }],
  });
});

test('gateway rejects an unknown Blanket size before inventory posting', () => {
  assert.throws(
    () => gatewayIdentityForRecord({
      productCode: 1,
      temperatureValue: 1260,
      densityValue: 128,
      sizeCode: 99,
    }),
    error => error?.code === 'INVALID_SIZE_CODE',
  );
});

test('gateway builds one traceable Blanket receipt with authoritative PLC weight', () => {
  const input = buildGatewayInventoryReceiptInput({
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
  assert.equal(input.idempotencyKey, 'PROD_GATEWAY:company-1:pi-gateway-1:record-1:1');
  assert.equal(input.receiptMode, 'PRODUCTION');
  assert.deepEqual(input.units, [{
    catchQuantity: 14.2,
    catchSource: 'PLC_PI',
    manufacturedAt: new Date(baseRecord.at),
    measuredAt: new Date(baseRecord.at),
  }]);
});

test('gateway uses weight as ET quantity and does not create an ET serial', () => {
  const input = buildGatewayInventoryReceiptInput({
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
  assert.equal(gatewayQuantityForItem(19.8, item), 1);
  const input = buildGatewayInventoryReceiptInput({
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

test('gateway fallback selects only the valid nos Plastic Bag Item', () => {
  const common = {
    status: 'active',
    familyId: { code: 'PLASTIC_BAG' },
    itemClassId: { code: 'PACKAGING' },
    capabilities: { inventory: true, consumable: true },
  };
  assert.deepEqual(
    eligibleGatewayPlasticBagItems([
      { _id: 'legacy-kg-bag', baseUom: 'kg', ...common },
      { _id: 'current-nos-bag', baseUom: 'nos', ...common },
      { _id: 'inactive-bag', baseUom: 'nos', ...common, status: 'archived' },
    ]).map(item => item._id),
    ['current-nos-bag'],
  );
});
