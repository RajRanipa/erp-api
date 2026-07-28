import assert from 'node:assert/strict';
import test from 'node:test';
import GoodsReceipt from '../models/GoodsReceipt.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseOrder, { PURCHASE_ORDER_STATUS } from '../models/PurchaseOrder.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import {
  calculateCommercialLine,
  calculateDocumentTotals,
  PROCUREMENT_STATUSES,
  roundMoney,
  roundQuantity,
} from '../services/procurementService.js';

test('procurement money is calculated server-side with deterministic rounding', () => {
  const line = calculateCommercialLine({
    quantity: 3,
    unitPrice: 127.335,
    discountPercent: 5,
    taxPercent: 18,
  });
  assert.deepEqual(line, {
    subtotal: 382.01,
    discountAmount: 19.1,
    taxableAmount: 362.91,
    taxAmount: 65.32,
    lineTotal: 428.23,
  });
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundQuantity(1.123456789), 1.123457);
});

test('document totals include controlled charges and signed round-off', () => {
  const totals = calculateDocumentTotals([
    {
      subtotal: 100,
      discountAmount: 10,
      taxableAmount: 90,
      taxAmount: 16.2,
    },
    {
      subtotal: 50,
      discountAmount: 0,
      taxableAmount: 50,
      taxAmount: 9,
    },
  ], {
    freight: 12,
    otherCharges: 3,
    roundOff: -0.2,
  });
  assert.deepEqual(totals, {
    subtotal: 150,
    discountTotal: 10,
    taxableTotal: 140,
    taxTotal: 25.2,
    freight: 12,
    otherCharges: 3,
    roundOff: -0.2,
    grandTotal: 180,
  });
});

test('procurement status catalogue and tenant indexes cover every document', () => {
  assert.deepEqual(
    new Set(PROCUREMENT_STATUSES.purchaseOrders),
    new Set(Object.values(PURCHASE_ORDER_STATUS)),
  );
  for (const Model of [PurchaseOrder, GoodsReceipt, PurchaseReturn, PurchaseInvoice]) {
    const indexes = Model.schema.indexes();
    assert.ok(
      indexes.some(([fields, options]) => (
        fields.companyId === 1
        && options.unique === true
      )),
      `${Model.modelName} must have a tenant-scoped unique document index`,
    );
    assert.ok(
      indexes.some(([fields]) => fields.companyId === 1 && fields.status === 1),
      `${Model.modelName} must have a tenant/status query index`,
    );
  }
});
