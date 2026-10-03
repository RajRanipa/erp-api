import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInsufficientAccountingStockMessage,
  buildLowStockMessage,
  summarizeInventoryMovements,
} from '../services/inventoryAlertService.js';

const item = {
  _id: 'item-id',
  name: 'Plastic bag',
  sku: 'ITEM-PLA-001',
  baseUom: 'nos',
  minimumStock: 100,
  familyId: { name: 'Plastic Bag' },
  itemClassId: { name: 'Packaging Material' },
};

test('low-stock message explains the threshold, shortage and triggering movement', () => {
  const message = buildLowStockMessage({
    item,
    stock: { available: 42, onHand: 50 },
    movement: { netQuantity: -8, availableDelta: -8 },
    transaction: {
      transactionNo: 'ISS-20261003-ABC',
      referenceType: 'PRODUCTION',
      referenceId: 'PO-009',
    },
    warehouseNames: ['Orient Main'],
  });

  assert.match(message, /ERP LOW STOCK ALERT/);
  assert.match(message, /Plastic bag \(ITEM-PLA-001\)/);
  assert.match(message, /Available stock: 42 nos/);
  assert.match(message, /Minimum stock: 100 nos/);
  assert.match(message, /Shortage: 58 nos/);
  assert.match(message, /Latest movement: OUT 8 nos/);
  assert.match(message, /Orient Main/);
  assert.match(message, /PRODUCTION \/ PO-009/);
});

test('insufficient accounting message includes quantities, valuation and action', () => {
  const message = buildInsufficientAccountingStockMessage({
    item,
    requestedQuantity: 25,
    balance: { quantity: 10, movingAverageCost: 2.5, currency: 'INR' },
    operationalStock: { available: 12, onHand: 14 },
    warehouseName: 'Orient Main',
    context: {
      operation: 'PURCHASE_RETURN',
      referenceType: 'PURCHASE_RETURN',
      referenceId: 'PRN-002',
    },
  });

  assert.match(message, /ERP INVENTORY ISSUE BLOCKED/);
  assert.match(message, /Requested issue: 25 nos/);
  assert.match(message, /Accounting stock: 10 nos/);
  assert.match(message, /Operational available: 12 nos/);
  assert.match(message, /Shortage: 15 nos/);
  assert.match(message, /Moving average cost: 2\.5 INR per nos/);
  assert.match(message, /Requested accounting value: 62\.5 INR/);
  assert.match(message, /receive or adjust accounting stock/i);
});

test('movement summary detects usable-stock loss but ignores warehouse-only transfers', () => {
  const qualityChange = summarizeInventoryMovements([
    {
      itemId: 'blanket',
      warehouseId: 'main',
      direction: 'OUT',
      quantity: 5,
      qualityStatus: 'AVAILABLE',
      processStatus: 'PACKED',
    },
    {
      itemId: 'blanket',
      warehouseId: 'main',
      direction: 'IN',
      quantity: 5,
      qualityStatus: 'REJECTED',
      processStatus: 'REJECTED',
    },
  ]);
  assert.equal(qualityChange.length, 1);
  assert.equal(qualityChange[0].netQuantity, 0);
  assert.equal(qualityChange[0].availableDelta, -5);

  const transfer = summarizeInventoryMovements([
    {
      itemId: 'raw-material',
      warehouseId: 'from',
      direction: 'OUT',
      quantity: 20,
      qualityStatus: 'AVAILABLE',
      processStatus: 'AVAILABLE',
    },
    {
      itemId: 'raw-material',
      warehouseId: 'to',
      direction: 'IN',
      quantity: 20,
      qualityStatus: 'AVAILABLE',
      processStatus: 'AVAILABLE',
    },
  ]);
  assert.deepEqual(transfer, []);
});
