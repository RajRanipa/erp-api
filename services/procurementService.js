import mongoose from 'mongoose';
import DocumentSequence from '../models/DocumentSequence.js';
import GoodsReceipt, {
  GOODS_RECEIPT_STATUS,
  INSPECTION_STATUS,
} from '../models/GoodsReceipt.js';
import Item from '../models/Item.js';
import Party from '../models/Party.js';
import PurchaseInvoice, {
  PURCHASE_INVOICE_STATUS,
} from '../models/PurchaseInvoice.js';
import PurchaseOrder, {
  PURCHASE_ORDER_STATUS,
} from '../models/PurchaseOrder.js';
import PurchaseReturn, {
  PURCHASE_RETURN_STATUS,
} from '../models/PurchaseReturn.js';
import Warehouse from '../models/Warehouse.js';
import { issue as issueInventory, receive as receiveInventory } from './inventoryService.js';
import { AppError } from '../utils/errorHandler.js';

const EPSILON = 0.000001;
const ALLOWED_ITEM_CATEGORIES = new Set(['RAW', 'PACKING', 'FG']);
const EDITABLE_PO_STATUSES = new Set([
  PURCHASE_ORDER_STATUS.DRAFT,
  PURCHASE_ORDER_STATUS.REJECTED,
]);

const fail = (message, statusCode = 400, code = 'PROCUREMENT_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

const asString = (value, maxLength = 5000) =>
  String(value ?? '').trim().slice(0, maxLength);

const normalizeOptional = (value, maxLength = 5000) => {
  const normalized = asString(value, maxLength);
  return normalized || null;
};

const validateId = (value, field) => {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${field} is invalid`, 400, 'INVALID_ID', { field });
  }
};

const positiveNumber = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw fail(`${field} must be greater than zero`, 400, 'INVALID_NUMBER', { field });
  }
  return number;
};

const nonNegativeNumber = (value, field, fallback = 0) => {
  const number = value === '' || value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw fail(`${field} must be zero or greater`, 400, 'INVALID_NUMBER', { field });
  }
  return number;
};

const percent = (value, field) => {
  const number = nonNegativeNumber(value, field);
  if (number > 100) {
    throw fail(`${field} cannot exceed 100`, 400, 'INVALID_PERCENTAGE', { field });
  }
  return number;
};

const parseDate = (value, field, { required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw fail(`${field} is required`, 400, 'REQUIRED_FIELD', { field });
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fail(`${field} is invalid`, 400, 'INVALID_DATE', { field });
  }
  return date;
};

export const roundMoney = value =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const roundQuantity = value =>
  Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;

export function calculateCommercialLine({
  quantity,
  unitPrice,
  discountPercent = 0,
  taxPercent = 0,
}) {
  const qty = positiveNumber(quantity, 'quantity');
  const price = nonNegativeNumber(unitPrice, 'unitPrice');
  const discountRate = percent(discountPercent, 'discountPercent');
  const taxRate = percent(taxPercent, 'taxPercent');
  const subtotal = roundMoney(qty * price);
  const discountAmount = roundMoney(subtotal * discountRate / 100);
  const taxableAmount = roundMoney(subtotal - discountAmount);
  const taxAmount = roundMoney(taxableAmount * taxRate / 100);
  return {
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    lineTotal: roundMoney(taxableAmount + taxAmount),
  };
}

export function calculateDocumentTotals(lines, {
  freight = 0,
  otherCharges = 0,
  roundOff = 0,
} = {}) {
  const safeFreight = nonNegativeNumber(freight, 'freight');
  const safeOtherCharges = nonNegativeNumber(otherCharges, 'otherCharges');
  const safeRoundOff = Number(roundOff || 0);
  if (!Number.isFinite(safeRoundOff) || Math.abs(safeRoundOff) > 999999) {
    throw fail('roundOff is invalid', 400, 'INVALID_NUMBER', { field: 'roundOff' });
  }
  const sum = field => roundMoney(lines.reduce(
    (total, line) => total + Number(line[field] || 0),
    0,
  ));
  const subtotal = sum('subtotal');
  const discountTotal = sum('discountAmount');
  const taxableTotal = sum('taxableAmount');
  const taxTotal = sum('taxAmount');
  return {
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    freight: roundMoney(safeFreight),
    otherCharges: roundMoney(safeOtherCharges),
    roundOff: roundMoney(safeRoundOff),
    grandTotal: roundMoney(
      taxableTotal + taxTotal + safeFreight + safeOtherCharges + safeRoundOff,
    ),
  };
}

function audit(action, fromStatus, toStatus, by, note = '') {
  return {
    action,
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    by,
    note: asString(note, 1000),
    at: new Date(),
  };
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function nextDocumentNumber({
  companyId,
  type,
  prefix,
  at = new Date(),
  session,
}) {
  const year = at.getUTCFullYear();
  const sequence = await DocumentSequence.findOneAndUpdate(
    { companyId, type, year },
    { $inc: { value: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      session,
    },
  );
  return `${prefix}-${year}-${String(sequence.value).padStart(6, '0')}`;
}

async function getSupplier(companyId, supplierId, session = null) {
  validateId(supplierId, 'supplierId');
  const query = Party.findOne({
    _id: supplierId,
    companyId,
    roles: 'SUPPLIER',
    status: 'active',
  }).select('code name legalName taxProfile paymentTerms currency addresses status roles');
  if (session) query.session(session);
  const supplier = await query.lean();
  if (!supplier) {
    throw fail(
      'Active supplier not found in this company',
      404,
      'SUPPLIER_NOT_FOUND',
    );
  }
  return supplier;
}

async function getWarehouse(companyId, warehouseId, session = null) {
  validateId(warehouseId, 'warehouseId');
  const query = Warehouse.findOne({
    _id: warehouseId,
    companyId,
    status: 'active',
  }).select('code name address state pincode');
  if (session) query.session(session);
  const warehouse = await query.lean();
  if (!warehouse) {
    throw fail(
      'Active warehouse not found in this company',
      404,
      'WAREHOUSE_NOT_FOUND',
    );
  }
  return warehouse;
}

async function getItems(companyId, itemIds, session = null) {
  const uniqueIds = [...new Set(itemIds.map(String))];
  uniqueIds.forEach(itemId => validateId(itemId, 'itemId'));
  const query = Item.find({
    _id: { $in: uniqueIds },
    companyId,
    status: 'active',
    categoryKey: { $in: [...ALLOWED_ITEM_CATEGORIES] },
  }).select('name sku categoryKey description UOM purchasePrice');
  if (session) query.session(session);
  const items = await query.lean();
  if (items.length !== uniqueIds.length) {
    throw fail(
      'One or more items are missing, inactive, or not purchasable',
      409,
      'INVALID_PURCHASE_ITEM',
    );
  }
  return new Map(items.map(item => [String(item._id), item]));
}

function deliveryAddressFrom(bodyAddress, warehouse) {
  const source = bodyAddress && typeof bodyAddress === 'object'
    ? bodyAddress
    : {};
  return {
    label: asString(source.label || warehouse.name, 80),
    line1: asString(source.line1 || warehouse.address, 240),
    line2: asString(source.line2, 240),
    city: asString(source.city, 100),
    state: asString(source.state || warehouse.state, 100),
    country: asString(source.country || 'India', 100),
    pincode: asString(source.pincode || warehouse.pincode, 24),
  };
}

function paymentTermsFrom(input, supplier) {
  const supplied = input && typeof input === 'object' ? input : {};
  const defaults = supplier.paymentTerms || {};
  const type = supplied.type || defaults.type || 'NET_DAYS';
  if (!['DUE_ON_RECEIPT', 'NET_DAYS', 'CUSTOM'].includes(type)) {
    throw fail('paymentTerms.type is invalid', 400, 'INVALID_PAYMENT_TERMS');
  }
  return {
    type,
    netDays: Math.min(
      3650,
      Math.trunc(nonNegativeNumber(
        supplied.netDays ?? defaults.netDays ?? 30,
        'paymentTerms.netDays',
      )),
    ),
    note: asString(supplied.note ?? defaults.note, 500),
  };
}

async function normalizeOrderInput(companyId, body, session) {
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length < 1 || rawLines.length > 200) {
    throw fail(
      'A purchase order requires between 1 and 200 lines',
      400,
      'INVALID_ORDER_LINES',
    );
  }
  // MongoDB transactions do not support parallel operations on one session.
  const supplier = await getSupplier(companyId, body.supplierId, session);
  const warehouse = await getWarehouse(companyId, body.warehouseId, session);
  const items = await getItems(
    companyId,
    rawLines.map(line => line.itemId),
    session,
  );
  const seenItems = new Set();
  const lines = rawLines.map((input, index) => {
    const item = items.get(String(input.itemId));
    if (seenItems.has(String(item._id))) {
      throw fail(
        `${item.name} appears more than once; combine duplicate lines`,
        400,
        'DUPLICATE_ORDER_ITEM',
      );
    }
    seenItems.add(String(item._id));
    const orderedQty = positiveNumber(input.orderedQty ?? input.quantity, `lines.${index}.orderedQty`);
    const unitPrice = nonNegativeNumber(
      input.unitPrice ?? item.purchasePrice,
      `lines.${index}.unitPrice`,
    );
    const discountPercent = percent(
      input.discountPercent,
      `lines.${index}.discountPercent`,
    );
    const taxPercent = percent(input.taxPercent, `lines.${index}.taxPercent`);
    const commercial = calculateCommercialLine({
      quantity: orderedQty,
      unitPrice,
      discountPercent,
      taxPercent,
    });
    return {
      lineNumber: index + 1,
      itemId: item._id,
      itemName: item.name,
      sku: item.sku || '',
      categoryKey: item.categoryKey,
      description: asString(input.description ?? item.description, 1000),
      orderedQty,
      uom: String(item.UOM).trim().toLowerCase(),
      unitPrice,
      discountPercent,
      taxPercent,
      hsnCode: asString(input.hsnCode, 30).toUpperCase(),
      ...commercial,
    };
  });
  const freight = nonNegativeNumber(body.freight, 'freight');
  const otherCharges = nonNegativeNumber(body.otherCharges, 'otherCharges');
  const roundOff = Number(body.roundOff || 0);
  const orderDate = parseDate(body.orderDate, 'orderDate') || new Date();
  const expectedDeliveryDate = parseDate(
    body.expectedDeliveryDate,
    'expectedDeliveryDate',
  );
  if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
    throw fail(
      'Expected delivery date cannot be before the order date',
      400,
      'INVALID_DELIVERY_DATE',
    );
  }
  const currency = asString(body.currency || supplier.currency || 'INR', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw fail('currency must be a three-letter ISO code', 400, 'INVALID_CURRENCY');
  }
  return {
    supplierId: supplier._id,
    supplierSnapshot: {
      code: supplier.code || '',
      name: supplier.legalName || supplier.name,
      taxId: supplier.taxProfile?.taxId || '',
    },
    warehouseId: warehouse._id,
    orderDate,
    expectedDeliveryDate,
    currency,
    paymentTerms: paymentTermsFrom(body.paymentTerms, supplier),
    deliveryAddress: deliveryAddressFrom(body.deliveryAddress, warehouse),
    lines,
    freight,
    otherCharges,
    roundOff: roundMoney(roundOff),
    totals: calculateDocumentTotals(lines, { freight, otherCharges, roundOff }),
    notes: asString(body.notes, 5000),
    terms: asString(body.terms, 10000),
    internalReference: asString(body.internalReference, 120),
  };
}

export async function createPurchaseOrder({ companyId, userId, body }) {
  validateId(companyId, 'companyId');
  validateId(userId, 'userId');
  return withTransaction(async session => {
    const normalized = await normalizeOrderInput(companyId, body, session);
    const poNumber = await nextDocumentNumber({
      companyId,
      type: 'PURCHASE_ORDER',
      prefix: 'PO',
      at: normalized.orderDate,
      session,
    });
    const [order] = await PurchaseOrder.create([{
      companyId,
      poNumber,
      ...normalized,
      createdBy: userId,
      updatedBy: userId,
      statusHistory: [
        audit('CREATED', null, PURCHASE_ORDER_STATUS.DRAFT, userId),
      ],
    }], { session });
    return order;
  });
}

export async function updatePurchaseOrder({ companyId, userId, orderId, body }) {
  validateId(orderId, 'orderId');
  return withTransaction(async session => {
    const order = await PurchaseOrder.findOne({ _id: orderId, companyId }).session(session);
    if (!order) throw fail('Purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND');
    if (!EDITABLE_PO_STATUSES.has(order.status)) {
      throw fail(
        'Only draft or rejected purchase orders can be edited',
        409,
        'PURCHASE_ORDER_NOT_EDITABLE',
      );
    }
    const normalized = await normalizeOrderInput(companyId, body, session);
    const fromStatus = order.status;
    order.set(normalized);
    order.status = PURCHASE_ORDER_STATUS.DRAFT;
    order.updatedBy = userId;
    order.statusHistory.push(audit(
      'UPDATED',
      fromStatus,
      PURCHASE_ORDER_STATUS.DRAFT,
      userId,
      body.changeNote,
    ));
    await order.save({ session });
    return order;
  });
}

const ORDER_TRANSITIONS = Object.freeze({
  submit: {
    from: [PURCHASE_ORDER_STATUS.DRAFT, PURCHASE_ORDER_STATUS.REJECTED],
    to: PURCHASE_ORDER_STATUS.PENDING_APPROVAL,
  },
  approve: {
    from: [PURCHASE_ORDER_STATUS.PENDING_APPROVAL],
    to: PURCHASE_ORDER_STATUS.APPROVED,
  },
  reject: {
    from: [PURCHASE_ORDER_STATUS.PENDING_APPROVAL],
    to: PURCHASE_ORDER_STATUS.REJECTED,
  },
  close: {
    from: [
      PURCHASE_ORDER_STATUS.APPROVED,
      PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
      PURCHASE_ORDER_STATUS.RECEIVED,
    ],
    to: PURCHASE_ORDER_STATUS.CLOSED,
  },
  cancel: {
    from: [
      PURCHASE_ORDER_STATUS.DRAFT,
      PURCHASE_ORDER_STATUS.PENDING_APPROVAL,
      PURCHASE_ORDER_STATUS.REJECTED,
      PURCHASE_ORDER_STATUS.APPROVED,
    ],
    to: PURCHASE_ORDER_STATUS.CANCELLED,
  },
});

export async function transitionPurchaseOrder({
  companyId,
  userId,
  orderId,
  action,
  note = '',
}) {
  validateId(orderId, 'orderId');
  const transition = ORDER_TRANSITIONS[action];
  if (!transition) throw fail('Invalid purchase order action', 400, 'INVALID_ACTION');
  if (action === 'reject' && !asString(note)) {
    throw fail('A rejection reason is required', 400, 'REJECTION_REASON_REQUIRED');
  }
  const order = await PurchaseOrder.findOne({ _id: orderId, companyId });
  if (!order) throw fail('Purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND');
  if (!transition.from.includes(order.status)) {
    throw fail(
      `Cannot ${action} a purchase order in ${order.status} status`,
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }
  if (action === 'cancel') {
    const [linkedReceipt, linkedInvoice] = await Promise.all([
      GoodsReceipt.exists({
        companyId,
        purchaseOrderId: order._id,
        status: { $ne: GOODS_RECEIPT_STATUS.CANCELLED },
      }),
      PurchaseInvoice.exists({
        companyId,
        purchaseOrderId: order._id,
        status: { $ne: PURCHASE_INVOICE_STATUS.CANCELLED },
      }),
    ]);
    if (linkedReceipt || linkedInvoice) {
      throw fail(
        'Cancel linked goods receipts and purchase invoices before cancelling this order',
        409,
        'PURCHASE_ORDER_HAS_DEPENDENCIES',
      );
    }
  }
  const fromStatus = order.status;
  order.status = transition.to;
  order.updatedBy = userId;
  order.statusHistory.push(audit(
    action.toUpperCase(),
    fromStatus,
    transition.to,
    userId,
    note,
  ));
  if (action === 'submit') {
    order.submittedAt = new Date();
    order.submittedBy = userId;
  } else if (action === 'approve') {
    order.approvedAt = new Date();
    order.approvedBy = userId;
  } else if (action === 'close') {
    order.closedAt = new Date();
  } else if (action === 'cancel') {
    order.cancelledAt = new Date();
  }
  await order.save();
  return order;
}

function receiptInspectionStatus(accepted, rejected, quarantined) {
  if (quarantined > EPSILON && accepted <= EPSILON && rejected <= EPSILON) {
    return INSPECTION_STATUS.PENDING;
  }
  if (accepted > EPSILON && (rejected > EPSILON || quarantined > EPSILON)) {
    return INSPECTION_STATUS.PARTIAL;
  }
  if (accepted > EPSILON) return INSPECTION_STATUS.PASSED;
  if (rejected > EPSILON) return INSPECTION_STATUS.FAILED;
  return INSPECTION_STATUS.PENDING;
}

function findOrderLine(order, poLineId) {
  validateId(poLineId, 'poLineId');
  const line = order.lines.id(poLineId);
  if (!line) {
    throw fail('Purchase order line not found', 404, 'PURCHASE_ORDER_LINE_NOT_FOUND');
  }
  return line;
}

function normalizeReceiptLines(order, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 200) {
    throw fail('A goods receipt requires between 1 and 200 lines', 400, 'INVALID_RECEIPT_LINES');
  }
  const seen = new Set();
  return rawLines.map((input, index) => {
    const poLine = findOrderLine(order, input.poLineId);
    if (seen.has(String(poLine._id))) {
      throw fail('A purchase order line may appear only once per receipt', 400, 'DUPLICATE_RECEIPT_LINE');
    }
    seen.add(String(poLine._id));
    const acceptedQty = nonNegativeNumber(input.acceptedQty, `lines.${index}.acceptedQty`);
    const rejectedQty = nonNegativeNumber(input.rejectedQty, `lines.${index}.rejectedQty`);
    const quarantinedQty = nonNegativeNumber(
      input.quarantinedQty,
      `lines.${index}.quarantinedQty`,
    );
    const receivedQty = roundQuantity(acceptedQty + rejectedQty + quarantinedQty);
    if (receivedQty <= EPSILON) {
      throw fail(`lines.${index} must receive a quantity`, 400, 'EMPTY_RECEIPT_LINE');
    }
    const outstanding = Math.max(
      0,
      Number(poLine.orderedQty) - Number(poLine.acceptedQty) - Number(poLine.quarantinedQty),
    );
    if (acceptedQty + quarantinedQty > outstanding + EPSILON) {
      throw fail(
        `${poLine.itemName} exceeds the outstanding order quantity`,
        409,
        'RECEIPT_EXCEEDS_ORDER',
        { outstanding },
      );
    }
    const manufacturedAt = parseDate(input.manufacturedAt, `lines.${index}.manufacturedAt`);
    const expiresAt = parseDate(input.expiresAt, `lines.${index}.expiresAt`);
    if (manufacturedAt && expiresAt && expiresAt <= manufacturedAt) {
      throw fail(
        `lines.${index}.expiresAt must be after manufacturedAt`,
        400,
        'INVALID_EXPIRY_DATE',
      );
    }
    return {
      poLineId: poLine._id,
      lineNumber: poLine.lineNumber,
      itemId: poLine.itemId,
      itemName: poLine.itemName,
      uom: poLine.uom,
      orderedQty: poLine.orderedQty,
      previouslyReceivedQty: poLine.receivedQty,
      receivedQty,
      acceptedQty,
      rejectedQty,
      quarantinedQty,
      inspectionStatus: receiptInspectionStatus(acceptedQty, rejectedQty, quarantinedQty),
      supplierBatchNo: asString(input.supplierBatchNo, 120),
      batchNo: asString(input.batchNo || input.supplierBatchNo, 120),
      bin: asString(input.bin, 120),
      manufacturedAt,
      expiresAt,
      remarks: asString(input.remarks, 1000),
    };
  });
}

export async function createGoodsReceipt({ companyId, userId, body }) {
  validateId(body.purchaseOrderId, 'purchaseOrderId');
  return withTransaction(async session => {
    const order = await PurchaseOrder.findOne({
      _id: body.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
        ],
      },
    }).session(session);
    if (!order) {
      throw fail(
        'Only approved open purchase orders can be received',
        409,
        'PURCHASE_ORDER_NOT_RECEIVABLE',
      );
    }
    const receivedAt = parseDate(body.receivedAt, 'receivedAt') || new Date();
    const lines = normalizeReceiptLines(order, body.lines);
    const grnNumber = await nextDocumentNumber({
      companyId,
      type: 'GOODS_RECEIPT',
      prefix: 'GRN',
      at: receivedAt,
      session,
    });
    const [receipt] = await GoodsReceipt.create([{
      companyId,
      grnNumber,
      purchaseOrderId: order._id,
      supplierId: order.supplierId,
      warehouseId: order.warehouseId,
      receivedAt,
      supplierInvoiceNo: asString(body.supplierInvoiceNo, 120),
      deliveryChallanNo: asString(body.deliveryChallanNo, 120),
      vehicleNo: asString(body.vehicleNo, 40).toUpperCase(),
      transporterName: asString(body.transporterName, 160),
      notes: asString(body.notes, 5000),
      lines,
      createdBy: userId,
      updatedBy: userId,
      statusHistory: [
        audit('CREATED', null, GOODS_RECEIPT_STATUS.DRAFT, userId),
      ],
    }], { session });
    return receipt;
  });
}

export async function updateGoodsReceipt({ companyId, userId, receiptId, body }) {
  validateId(receiptId, 'receiptId');
  validateId(body.purchaseOrderId, 'purchaseOrderId');
  return withTransaction(async session => {
    const receipt = await GoodsReceipt.findOne({
      _id: receiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.DRAFT,
    }).session(session);
    if (!receipt) throw fail('Draft goods receipt not found', 404, 'GOODS_RECEIPT_NOT_FOUND');
    if (String(receipt.purchaseOrderId) !== String(body.purchaseOrderId)) {
      throw fail('A draft receipt cannot be moved to another purchase order', 409, 'IMMUTABLE_DOCUMENT_LINK');
    }
    const order = await PurchaseOrder.findOne({
      _id: receipt.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
        ],
      },
    }).session(session);
    if (!order) throw fail('Purchase order is no longer receivable', 409, 'PURCHASE_ORDER_NOT_RECEIVABLE');
    receipt.receivedAt = parseDate(body.receivedAt, 'receivedAt') || receipt.receivedAt;
    receipt.supplierInvoiceNo = asString(body.supplierInvoiceNo, 120);
    receipt.deliveryChallanNo = asString(body.deliveryChallanNo, 120);
    receipt.vehicleNo = asString(body.vehicleNo, 40).toUpperCase();
    receipt.transporterName = asString(body.transporterName, 160);
    receipt.notes = asString(body.notes, 5000);
    receipt.lines = normalizeReceiptLines(order, body.lines);
    receipt.updatedBy = userId;
    receipt.statusHistory.push(audit(
      'UPDATED',
      GOODS_RECEIPT_STATUS.DRAFT,
      GOODS_RECEIPT_STATUS.DRAFT,
      userId,
      body.changeNote,
    ));
    await receipt.save({ session });
    return receipt;
  });
}

function recomputeOrderReceiptStatus(order) {
  const fullyReceived = order.lines.every(
    line => Number(line.acceptedQty) + EPSILON >= Number(line.orderedQty),
  );
  const hasReceipt = order.lines.some(
    line => Number(line.receivedQty) > EPSILON,
  );
  if (fullyReceived) return PURCHASE_ORDER_STATUS.RECEIVED;
  if (hasReceipt) return PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED;
  return PURCHASE_ORDER_STATUS.APPROVED;
}

export async function postGoodsReceipt({ companyId, userId, receiptId }) {
  validateId(receiptId, 'receiptId');
  return withTransaction(async session => {
    const receipt = await GoodsReceipt.findOne({
      _id: receiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.DRAFT,
    }).session(session);
    if (!receipt) {
      throw fail('Draft goods receipt not found', 404, 'GOODS_RECEIPT_NOT_FOUND');
    }
    const order = await PurchaseOrder.findOne({
      _id: receipt.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
        ],
      },
    }).session(session);
    if (!order) {
      throw fail('Purchase order is no longer receivable', 409, 'PURCHASE_ORDER_NOT_RECEIVABLE');
    }

    for (const receiptLine of receipt.lines) {
      const poLine = findOrderLine(order, receiptLine.poLineId);
      const accepted = Number(receiptLine.acceptedQty);
      const quarantined = Number(receiptLine.quarantinedQty);
      const outstanding = Math.max(
        0,
        Number(poLine.orderedQty) - Number(poLine.acceptedQty) - Number(poLine.quarantinedQty),
      );
      if (accepted + quarantined > outstanding + EPSILON) {
        throw fail(
          `${poLine.itemName} exceeds the remaining quantity; another receipt may have posted`,
          409,
          'RECEIPT_EXCEEDS_ORDER',
          { outstanding },
        );
      }
      if (accepted > EPSILON) {
        const requestId = `GRN:${receipt._id}:${receiptLine._id}`;
        await receiveInventory({
          companyId,
          itemId: receiptLine.itemId,
          warehouseId: receipt.warehouseId,
          uom: receiptLine.uom,
          qty: accepted,
          by: userId,
          at: receipt.receivedAt,
          note: `Accepted against ${receipt.grnNumber}`,
          refType: 'GOODS_RECEIPT',
          refId: receipt.grnNumber,
          batchNo: normalizeOptional(receiptLine.batchNo, 120),
          bin: normalizeOptional(receiptLine.bin, 120),
          idempotencyKey: requestId,
          session,
        });
        receiptLine.inventoryPostedQty = accepted;
        receiptLine.inventoryRequestId = requestId;
      }
      poLine.receivedQty = roundQuantity(Number(poLine.receivedQty) + Number(receiptLine.receivedQty));
      poLine.acceptedQty = roundQuantity(Number(poLine.acceptedQty) + accepted);
      poLine.rejectedQty = roundQuantity(Number(poLine.rejectedQty) + Number(receiptLine.rejectedQty));
      poLine.quarantinedQty = roundQuantity(Number(poLine.quarantinedQty) + quarantined);
    }

    const oldOrderStatus = order.status;
    order.status = recomputeOrderReceiptStatus(order);
    order.updatedBy = userId;
    if (oldOrderStatus !== order.status) {
      order.statusHistory.push(audit(
        'RECEIPT_POSTED',
        oldOrderStatus,
        order.status,
        userId,
        receipt.grnNumber,
      ));
    }
    receipt.status = GOODS_RECEIPT_STATUS.POSTED;
    receipt.postedAt = new Date();
    receipt.postedBy = userId;
    receipt.updatedBy = userId;
    receipt.statusHistory.push(audit(
      'POSTED',
      GOODS_RECEIPT_STATUS.DRAFT,
      GOODS_RECEIPT_STATUS.POSTED,
      userId,
    ));
    await order.save({ session });
    await receipt.save({ session });
    return receipt;
  });
}

export async function resolveGoodsReceiptInspection({
  companyId,
  userId,
  receiptId,
  body,
}) {
  validateId(receiptId, 'receiptId');
  const resolutions = Array.isArray(body.lines) ? body.lines : [];
  if (!resolutions.length || resolutions.length > 200) {
    throw fail('At least one quarantine resolution is required', 400, 'INVALID_INSPECTION_LINES');
  }
  return withTransaction(async session => {
    const receipt = await GoodsReceipt.findOne({
      _id: receiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.POSTED,
    }).session(session);
    if (!receipt) {
      throw fail('Posted goods receipt not found', 404, 'GOODS_RECEIPT_NOT_FOUND');
    }
    const order = await PurchaseOrder.findOne({
      _id: receipt.purchaseOrderId,
      companyId,
    }).session(session);
    if (!order) throw fail('Linked purchase order not found', 409, 'BROKEN_DOCUMENT_LINK');
    const seen = new Set();

    for (let index = 0; index < resolutions.length; index += 1) {
      const resolution = resolutions[index];
      validateId(resolution.goodsReceiptLineId, 'goodsReceiptLineId');
      const receiptLine = receipt.lines.id(resolution.goodsReceiptLineId);
      if (!receiptLine || seen.has(String(receiptLine._id))) {
        throw fail(
          receiptLine ? 'A receipt line may be resolved only once per request' : 'Goods receipt line not found',
          400,
          receiptLine ? 'DUPLICATE_INSPECTION_LINE' : 'GOODS_RECEIPT_LINE_NOT_FOUND',
        );
      }
      seen.add(String(receiptLine._id));
      const pending = roundQuantity(
        Number(receiptLine.quarantinedQty)
        - Number(receiptLine.quarantineAcceptedQty)
        - Number(receiptLine.quarantineRejectedQty),
      );
      if (pending <= EPSILON) {
        throw fail(
          `${receiptLine.itemName} has no pending quarantine quantity`,
          409,
          'NO_PENDING_QUARANTINE',
        );
      }
      const accepted = nonNegativeNumber(
        resolution.acceptedQty,
        `lines.${index}.acceptedQty`,
      );
      const rejected = nonNegativeNumber(
        resolution.rejectedQty,
        `lines.${index}.rejectedQty`,
      );
      if (Math.abs(accepted + rejected - pending) > EPSILON) {
        throw fail(
          `${receiptLine.itemName} must resolve all ${pending} pending units`,
          400,
          'INCOMPLETE_QUARANTINE_RESOLUTION',
          { pending },
        );
      }
      if (accepted > EPSILON) {
        const requestId = `GRN-QC:${receipt._id}:${receiptLine._id}`;
        await receiveInventory({
          companyId,
          itemId: receiptLine.itemId,
          warehouseId: receipt.warehouseId,
          uom: receiptLine.uom,
          qty: accepted,
          by: userId,
          at: new Date(),
          note: `Quarantine accepted against ${receipt.grnNumber}`,
          refType: 'GOODS_RECEIPT_QC',
          refId: receipt.grnNumber,
          batchNo: normalizeOptional(receiptLine.batchNo, 120),
          bin: normalizeOptional(receiptLine.bin, 120),
          idempotencyKey: requestId,
          session,
        });
        receiptLine.inventoryPostedQty = roundQuantity(
          Number(receiptLine.inventoryPostedQty) + accepted,
        );
      }
      receiptLine.quarantineAcceptedQty = roundQuantity(
        Number(receiptLine.quarantineAcceptedQty) + accepted,
      );
      receiptLine.quarantineRejectedQty = roundQuantity(
        Number(receiptLine.quarantineRejectedQty) + rejected,
      );
      receiptLine.acceptedQty = roundQuantity(Number(receiptLine.acceptedQty) + accepted);
      receiptLine.rejectedQty = roundQuantity(Number(receiptLine.rejectedQty) + rejected);
      receiptLine.inspectionStatus = accepted > EPSILON && rejected > EPSILON
        ? INSPECTION_STATUS.PARTIAL
        : accepted > EPSILON ? INSPECTION_STATUS.PASSED : INSPECTION_STATUS.FAILED;
      receiptLine.inspectionResolvedAt = new Date();
      receiptLine.inspectionResolvedBy = userId;

      const poLine = findOrderLine(order, receiptLine.poLineId);
      poLine.acceptedQty = roundQuantity(Number(poLine.acceptedQty) + accepted);
      poLine.rejectedQty = roundQuantity(Number(poLine.rejectedQty) + rejected);
      poLine.quarantinedQty = roundQuantity(
        Math.max(0, Number(poLine.quarantinedQty) - accepted - rejected),
      );
    }

    const oldStatus = order.status;
    order.status = recomputeOrderReceiptStatus(order);
    order.updatedBy = userId;
    if (oldStatus !== order.status) {
      order.statusHistory.push(audit(
        'QUARANTINE_RESOLVED',
        oldStatus,
        order.status,
        userId,
        receipt.grnNumber,
      ));
    }
    receipt.updatedBy = userId;
    receipt.statusHistory.push(audit(
      'QUARANTINE_RESOLVED',
      receipt.status,
      receipt.status,
      userId,
      body.note,
    ));
    await order.save({ session });
    await receipt.save({ session });
    return receipt;
  });
}

async function cancelDraftDocument({
  Model,
  companyId,
  userId,
  documentId,
  idField,
  draftStatus,
  cancelledStatus,
  notFoundCode,
  note,
}) {
  validateId(documentId, idField);
  const document = await Model.findOne({
    _id: documentId,
    companyId,
    status: draftStatus,
  });
  if (!document) throw fail('Draft document not found', 404, notFoundCode);
  document.status = cancelledStatus;
  document.cancelledAt = new Date();
  document.updatedBy = userId;
  document.statusHistory.push(audit(
    'CANCELLED',
    draftStatus,
    cancelledStatus,
    userId,
    note,
  ));
  await document.save();
  return document;
}

export function cancelGoodsReceipt(params) {
  return cancelDraftDocument({
    Model: GoodsReceipt,
    documentId: params.receiptId,
    idField: 'receiptId',
    draftStatus: GOODS_RECEIPT_STATUS.DRAFT,
    cancelledStatus: GOODS_RECEIPT_STATUS.CANCELLED,
    notFoundCode: 'GOODS_RECEIPT_NOT_FOUND',
    ...params,
  });
}

function normalizeReturnLines(receipt, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 200) {
    throw fail('A purchase return requires between 1 and 200 lines', 400, 'INVALID_RETURN_LINES');
  }
  const seen = new Set();
  return rawLines.map((input, index) => {
    validateId(input.goodsReceiptLineId, 'goodsReceiptLineId');
    const receiptLine = receipt.lines.id(input.goodsReceiptLineId);
    if (!receiptLine) {
      throw fail('Goods receipt line not found', 404, 'GOODS_RECEIPT_LINE_NOT_FOUND');
    }
    if (seen.has(String(receiptLine._id))) {
      throw fail('A receipt line may appear only once per return', 400, 'DUPLICATE_RETURN_LINE');
    }
    seen.add(String(receiptLine._id));
    const qty = positiveNumber(input.qty, `lines.${index}.qty`);
    const available = Math.max(
      0,
      Number(receiptLine.acceptedQty) - Number(receiptLine.returnedQty),
    );
    if (qty > available + EPSILON) {
      throw fail(
        `${receiptLine.itemName} return quantity exceeds received stock`,
        409,
        'RETURN_EXCEEDS_RECEIPT',
        { available },
      );
    }
    const reason = input.reason || 'QUALITY_REJECTION';
    if (!['QUALITY_REJECTION', 'DAMAGED', 'EXCESS', 'WRONG_ITEM', 'OTHER'].includes(reason)) {
      throw fail(`lines.${index}.reason is invalid`, 400, 'INVALID_RETURN_REASON');
    }
    return {
      goodsReceiptLineId: receiptLine._id,
      itemId: receiptLine.itemId,
      itemName: receiptLine.itemName,
      qty,
      uom: receiptLine.uom,
      batchNo: receiptLine.batchNo || '',
      bin: receiptLine.bin || '',
      reason,
      remarks: asString(input.remarks, 1000),
    };
  });
}

export async function createPurchaseReturn({ companyId, userId, body }) {
  validateId(body.goodsReceiptId, 'goodsReceiptId');
  return withTransaction(async session => {
    const receipt = await GoodsReceipt.findOne({
      _id: body.goodsReceiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.POSTED,
    }).session(session);
    if (!receipt) {
      throw fail('Posted goods receipt not found', 404, 'GOODS_RECEIPT_NOT_FOUND');
    }
    const returnDate = parseDate(body.returnDate, 'returnDate') || new Date();
    const lines = normalizeReturnLines(receipt, body.lines);
    const returnNumber = await nextDocumentNumber({
      companyId,
      type: 'PURCHASE_RETURN',
      prefix: 'PRN',
      at: returnDate,
      session,
    });
    const [purchaseReturn] = await PurchaseReturn.create([{
      companyId,
      returnNumber,
      purchaseOrderId: receipt.purchaseOrderId,
      goodsReceiptId: receipt._id,
      supplierId: receipt.supplierId,
      warehouseId: receipt.warehouseId,
      returnDate,
      supplierCreditNoteNo: asString(body.supplierCreditNoteNo, 120),
      lines,
      notes: asString(body.notes, 5000),
      createdBy: userId,
      updatedBy: userId,
      statusHistory: [
        audit('CREATED', null, PURCHASE_RETURN_STATUS.DRAFT, userId),
      ],
    }], { session });
    return purchaseReturn;
  });
}

export async function updatePurchaseReturn({ companyId, userId, returnId, body }) {
  validateId(returnId, 'returnId');
  validateId(body.goodsReceiptId, 'goodsReceiptId');
  return withTransaction(async session => {
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: returnId,
      companyId,
      status: PURCHASE_RETURN_STATUS.DRAFT,
    }).session(session);
    if (!purchaseReturn) throw fail('Draft purchase return not found', 404, 'PURCHASE_RETURN_NOT_FOUND');
    if (String(purchaseReturn.goodsReceiptId) !== String(body.goodsReceiptId)) {
      throw fail('A draft return cannot be moved to another goods receipt', 409, 'IMMUTABLE_DOCUMENT_LINK');
    }
    const receipt = await GoodsReceipt.findOne({
      _id: purchaseReturn.goodsReceiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.POSTED,
    }).session(session);
    if (!receipt) throw fail('Posted goods receipt not found', 404, 'GOODS_RECEIPT_NOT_FOUND');
    purchaseReturn.returnDate = parseDate(body.returnDate, 'returnDate') || purchaseReturn.returnDate;
    purchaseReturn.supplierCreditNoteNo = asString(body.supplierCreditNoteNo, 120);
    purchaseReturn.notes = asString(body.notes, 5000);
    purchaseReturn.lines = normalizeReturnLines(receipt, body.lines);
    purchaseReturn.updatedBy = userId;
    purchaseReturn.statusHistory.push(audit(
      'UPDATED',
      PURCHASE_RETURN_STATUS.DRAFT,
      PURCHASE_RETURN_STATUS.DRAFT,
      userId,
      body.changeNote,
    ));
    await purchaseReturn.save({ session });
    return purchaseReturn;
  });
}

export async function postPurchaseReturn({ companyId, userId, returnId }) {
  validateId(returnId, 'returnId');
  return withTransaction(async session => {
    const purchaseReturn = await PurchaseReturn.findOne({
      _id: returnId,
      companyId,
      status: PURCHASE_RETURN_STATUS.DRAFT,
    }).session(session);
    if (!purchaseReturn) {
      throw fail('Draft purchase return not found', 404, 'PURCHASE_RETURN_NOT_FOUND');
    }
    const receipt = await GoodsReceipt.findOne({
      _id: purchaseReturn.goodsReceiptId,
      companyId,
      status: GOODS_RECEIPT_STATUS.POSTED,
    }).session(session);
    const order = await PurchaseOrder.findOne({
      _id: purchaseReturn.purchaseOrderId,
      companyId,
    }).session(session);
    if (!receipt || !order) {
      throw fail('Linked procurement documents are missing', 409, 'BROKEN_DOCUMENT_LINK');
    }

    for (const returnLine of purchaseReturn.lines) {
      const receiptLine = receipt.lines.id(returnLine.goodsReceiptLineId);
      const available = receiptLine
        ? Number(receiptLine.acceptedQty) - Number(receiptLine.returnedQty)
        : 0;
      if (!receiptLine || Number(returnLine.qty) > available + EPSILON) {
        throw fail(
          `${returnLine.itemName} return quantity is no longer available`,
          409,
          'RETURN_EXCEEDS_RECEIPT',
          { available: Math.max(0, available) },
        );
      }
      const requestId = `PRN:${purchaseReturn._id}:${returnLine._id}`;
      await issueInventory({
        companyId,
        itemId: returnLine.itemId,
        warehouseId: purchaseReturn.warehouseId,
        uom: returnLine.uom,
        qty: returnLine.qty,
        by: userId,
        at: purchaseReturn.returnDate,
        note: `${returnLine.reason} against ${purchaseReturn.returnNumber}`,
        refType: 'PURCHASE_RETURN',
        refId: purchaseReturn.returnNumber,
        batchNo: normalizeOptional(returnLine.batchNo, 120),
        bin: normalizeOptional(returnLine.bin, 120),
        idempotencyKey: requestId,
        session,
      });
      returnLine.inventoryRequestId = requestId;
      receiptLine.returnedQty = roundQuantity(
        Number(receiptLine.returnedQty) + Number(returnLine.qty),
      );
      const poLine = order.lines.id(receiptLine.poLineId);
      if (poLine) {
        poLine.returnedQty = roundQuantity(Number(poLine.returnedQty) + Number(returnLine.qty));
      }
    }

    purchaseReturn.status = PURCHASE_RETURN_STATUS.POSTED;
    purchaseReturn.postedAt = new Date();
    purchaseReturn.postedBy = userId;
    purchaseReturn.updatedBy = userId;
    purchaseReturn.statusHistory.push(audit(
      'POSTED',
      PURCHASE_RETURN_STATUS.DRAFT,
      PURCHASE_RETURN_STATUS.POSTED,
      userId,
    ));
    await receipt.save({ session });
    await order.save({ session });
    await purchaseReturn.save({ session });
    return purchaseReturn;
  });
}

export function cancelPurchaseReturn(params) {
  return cancelDraftDocument({
    Model: PurchaseReturn,
    documentId: params.returnId,
    idField: 'returnId',
    draftStatus: PURCHASE_RETURN_STATUS.DRAFT,
    cancelledStatus: PURCHASE_RETURN_STATUS.CANCELLED,
    notFoundCode: 'PURCHASE_RETURN_NOT_FOUND',
    ...params,
  });
}

function normalizeInvoiceLines(order, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 200) {
    throw fail('A purchase invoice requires between 1 and 200 lines', 400, 'INVALID_INVOICE_LINES');
  }
  const seen = new Set();
  return rawLines.map((input, index) => {
    const poLine = findOrderLine(order, input.poLineId);
    if (seen.has(String(poLine._id))) {
      throw fail('A purchase order line may appear only once per invoice', 400, 'DUPLICATE_INVOICE_LINE');
    }
    seen.add(String(poLine._id));
    const invoicedQty = positiveNumber(input.invoicedQty, `lines.${index}.invoicedQty`);
    const unitPrice = nonNegativeNumber(
      input.unitPrice ?? poLine.unitPrice,
      `lines.${index}.unitPrice`,
    );
    const discountPercent = percent(
      input.discountPercent ?? poLine.discountPercent,
      `lines.${index}.discountPercent`,
    );
    const taxPercent = percent(
      input.taxPercent ?? poLine.taxPercent,
      `lines.${index}.taxPercent`,
    );
    return {
      poLineId: poLine._id,
      itemId: poLine.itemId,
      itemName: poLine.itemName,
      invoicedQty,
      uom: poLine.uom,
      unitPrice,
      discountPercent,
      taxPercent,
      ...calculateCommercialLine({
        quantity: invoicedQty,
        unitPrice,
        discountPercent,
        taxPercent,
      }),
    };
  });
}

export async function createPurchaseInvoice({ companyId, userId, body }) {
  validateId(body.purchaseOrderId, 'purchaseOrderId');
  return withTransaction(async session => {
    const order = await PurchaseOrder.findOne({
      _id: body.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
          PURCHASE_ORDER_STATUS.RECEIVED,
          PURCHASE_ORDER_STATUS.CLOSED,
        ],
      },
    }).session(session);
    if (!order) {
      throw fail('Approved purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND');
    }
    const supplierInvoiceNumber = asString(body.supplierInvoiceNumber, 120).toUpperCase();
    if (!supplierInvoiceNumber) {
      throw fail('supplierInvoiceNumber is required', 400, 'SUPPLIER_INVOICE_REQUIRED');
    }
    const invoiceDate = parseDate(body.invoiceDate, 'invoiceDate') || new Date();
    const dueDate = parseDate(body.dueDate, 'dueDate');
    if (dueDate && dueDate < invoiceDate) {
      throw fail('Due date cannot be before invoice date', 400, 'INVALID_DUE_DATE');
    }
    const lines = normalizeInvoiceLines(order, body.lines);
    const freight = nonNegativeNumber(body.freight, 'freight');
    const otherCharges = nonNegativeNumber(body.otherCharges, 'otherCharges');
    const roundOff = Number(body.roundOff || 0);
    const invoiceNumber = await nextDocumentNumber({
      companyId,
      type: 'PURCHASE_INVOICE',
      prefix: 'PINV',
      at: invoiceDate,
      session,
    });
    const receipts = await GoodsReceipt.find({
      companyId,
      purchaseOrderId: order._id,
      status: GOODS_RECEIPT_STATUS.POSTED,
    }).select('_id').session(session).lean();
    const [invoice] = await PurchaseInvoice.create([{
      companyId,
      invoiceNumber,
      supplierInvoiceNumber,
      purchaseOrderId: order._id,
      goodsReceiptIds: receipts.map(receipt => receipt._id),
      supplierId: order.supplierId,
      invoiceDate,
      dueDate,
      currency: order.currency,
      lines,
      freight,
      otherCharges,
      roundOff: roundMoney(roundOff),
      totals: calculateDocumentTotals(lines, { freight, otherCharges, roundOff }),
      notes: asString(body.notes, 5000),
      createdBy: userId,
      updatedBy: userId,
      statusHistory: [
        audit('CREATED', null, PURCHASE_INVOICE_STATUS.DRAFT, userId),
      ],
    }], { session });
    return invoice;
  });
}

export async function updatePurchaseInvoice({ companyId, userId, invoiceId, body }) {
  validateId(invoiceId, 'invoiceId');
  validateId(body.purchaseOrderId, 'purchaseOrderId');
  return withTransaction(async session => {
    const invoice = await PurchaseInvoice.findOne({
      _id: invoiceId,
      companyId,
      status: PURCHASE_INVOICE_STATUS.DRAFT,
    }).session(session);
    if (!invoice) throw fail('Draft purchase invoice not found', 404, 'PURCHASE_INVOICE_NOT_FOUND');
    if (String(invoice.purchaseOrderId) !== String(body.purchaseOrderId)) {
      throw fail('A draft invoice cannot be moved to another purchase order', 409, 'IMMUTABLE_DOCUMENT_LINK');
    }
    const order = await PurchaseOrder.findOne({
      _id: invoice.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
          PURCHASE_ORDER_STATUS.RECEIVED,
          PURCHASE_ORDER_STATUS.CLOSED,
        ],
      },
    }).session(session);
    if (!order) throw fail('Linked purchase order is not invoiceable', 409, 'PURCHASE_ORDER_NOT_INVOICEABLE');
    const supplierInvoiceNumber = asString(body.supplierInvoiceNumber, 120).toUpperCase();
    if (!supplierInvoiceNumber) {
      throw fail('supplierInvoiceNumber is required', 400, 'SUPPLIER_INVOICE_REQUIRED');
    }
    const invoiceDate = parseDate(body.invoiceDate, 'invoiceDate') || invoice.invoiceDate;
    const dueDate = parseDate(body.dueDate, 'dueDate');
    if (dueDate && dueDate < invoiceDate) {
      throw fail('Due date cannot be before invoice date', 400, 'INVALID_DUE_DATE');
    }
    const lines = normalizeInvoiceLines(order, body.lines);
    const freight = nonNegativeNumber(body.freight, 'freight');
    const otherCharges = nonNegativeNumber(body.otherCharges, 'otherCharges');
    const roundOff = Number(body.roundOff || 0);
    invoice.supplierInvoiceNumber = supplierInvoiceNumber;
    invoice.invoiceDate = invoiceDate;
    invoice.dueDate = dueDate;
    invoice.lines = lines;
    invoice.freight = freight;
    invoice.otherCharges = otherCharges;
    invoice.roundOff = roundMoney(roundOff);
    invoice.totals = calculateDocumentTotals(lines, { freight, otherCharges, roundOff });
    invoice.notes = asString(body.notes, 5000);
    invoice.updatedBy = userId;
    invoice.statusHistory.push(audit(
      'UPDATED',
      PURCHASE_INVOICE_STATUS.DRAFT,
      PURCHASE_INVOICE_STATUS.DRAFT,
      userId,
      body.changeNote,
    ));
    await invoice.save({ session });
    return invoice;
  });
}

export async function verifyPurchaseInvoice({ companyId, userId, invoiceId }) {
  validateId(invoiceId, 'invoiceId');
  return withTransaction(async session => {
    const invoice = await PurchaseInvoice.findOne({
      _id: invoiceId,
      companyId,
      status: PURCHASE_INVOICE_STATUS.DRAFT,
    }).session(session);
    if (!invoice) {
      throw fail('Draft purchase invoice not found', 404, 'PURCHASE_INVOICE_NOT_FOUND');
    }
    const order = await PurchaseOrder.findOne({
      _id: invoice.purchaseOrderId,
      companyId,
      status: {
        $in: [
          PURCHASE_ORDER_STATUS.APPROVED,
          PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
          PURCHASE_ORDER_STATUS.RECEIVED,
          PURCHASE_ORDER_STATUS.CLOSED,
        ],
      },
    }).session(session);
    if (!order) throw fail('Linked purchase order is not invoiceable', 409, 'PURCHASE_ORDER_NOT_INVOICEABLE');

    const variances = [];
    for (const invoiceLine of invoice.lines) {
      const poLine = order.lines.id(invoiceLine.poLineId);
      if (!poLine) {
        variances.push({
          lineId: invoiceLine._id,
          itemId: invoiceLine.itemId,
          type: 'OTHER',
          message: 'The matching purchase order line no longer exists',
        });
        continue;
      }
      const netAccepted = Math.max(
        0,
        Number(poLine.acceptedQty) - Number(poLine.returnedQty),
      );
      const availableToInvoice = Math.max(
        0,
        netAccepted - Number(poLine.invoicedQty || 0),
      );
      if (netAccepted <= EPSILON) {
        variances.push({
          lineId: invoiceLine._id,
          itemId: invoiceLine.itemId,
          type: 'MISSING_RECEIPT',
          expected: invoiceLine.invoicedQty,
          actual: 0,
          message: `${invoiceLine.itemName} has not been accepted into stock`,
        });
      } else if (Number(invoiceLine.invoicedQty) > availableToInvoice + EPSILON) {
        variances.push({
          lineId: invoiceLine._id,
          itemId: invoiceLine.itemId,
          type: 'QUANTITY',
          expected: availableToInvoice,
          actual: invoiceLine.invoicedQty,
          message: `${invoiceLine.itemName} invoice quantity exceeds the uninvoiced accepted quantity`,
        });
      }
      if (Math.abs(Number(invoiceLine.unitPrice) - Number(poLine.unitPrice)) > 0.01) {
        variances.push({
          lineId: invoiceLine._id,
          itemId: invoiceLine.itemId,
          type: 'PRICE',
          expected: poLine.unitPrice,
          actual: invoiceLine.unitPrice,
          message: `${invoiceLine.itemName} invoice price differs from the purchase order`,
        });
      }
      poLine.invoicedQty = roundQuantity(
        Number(poLine.invoicedQty || 0) + Number(invoiceLine.invoicedQty),
      );
    }
    invoice.variances = variances;
    invoice.matchStatus = variances.length ? 'VARIANCE' : 'MATCHED';
    invoice.status = PURCHASE_INVOICE_STATUS.VERIFIED;
    invoice.verifiedAt = new Date();
    invoice.verifiedBy = userId;
    invoice.updatedBy = userId;
    invoice.statusHistory.push(audit(
      'VERIFIED',
      PURCHASE_INVOICE_STATUS.DRAFT,
      PURCHASE_INVOICE_STATUS.VERIFIED,
      userId,
      variances.length ? `${variances.length} variance(s)` : 'Three-way match passed',
    ));
    order.updatedBy = userId;
    await order.save({ session });
    await invoice.save({ session });
    return invoice;
  });
}

const INVOICE_TRANSITIONS = Object.freeze({
  approve: {
    from: PURCHASE_INVOICE_STATUS.VERIFIED,
    to: PURCHASE_INVOICE_STATUS.APPROVED,
  },
  paid: {
    from: PURCHASE_INVOICE_STATUS.APPROVED,
    to: PURCHASE_INVOICE_STATUS.PAID,
  },
  cancel: {
    from: [PURCHASE_INVOICE_STATUS.DRAFT, PURCHASE_INVOICE_STATUS.VERIFIED],
    to: PURCHASE_INVOICE_STATUS.CANCELLED,
  },
});

export async function transitionPurchaseInvoice({
  companyId,
  userId,
  invoiceId,
  action,
  note = '',
}) {
  validateId(invoiceId, 'invoiceId');
  const transition = INVOICE_TRANSITIONS[action];
  if (!transition) throw fail('Invalid purchase invoice action', 400, 'INVALID_ACTION');
  if (action === 'cancel') {
    return withTransaction(async session => {
      const invoice = await PurchaseInvoice.findOne({ _id: invoiceId, companyId }).session(session);
      if (!invoice) throw fail('Purchase invoice not found', 404, 'PURCHASE_INVOICE_NOT_FOUND');
      if (![PURCHASE_INVOICE_STATUS.DRAFT, PURCHASE_INVOICE_STATUS.VERIFIED].includes(invoice.status)) {
        throw fail(
          `Cannot cancel a purchase invoice in ${invoice.status} status`,
          409,
          'INVALID_STATUS_TRANSITION',
        );
      }
      const fromStatus = invoice.status;
      if (fromStatus === PURCHASE_INVOICE_STATUS.VERIFIED) {
        const order = await PurchaseOrder.findOne({
          _id: invoice.purchaseOrderId,
          companyId,
        }).session(session);
        if (!order) throw fail('Linked purchase order not found', 409, 'BROKEN_DOCUMENT_LINK');
        for (const invoiceLine of invoice.lines) {
          const poLine = order.lines.id(invoiceLine.poLineId);
          if (poLine) {
            poLine.invoicedQty = roundQuantity(Math.max(
              0,
              Number(poLine.invoicedQty || 0) - Number(invoiceLine.invoicedQty),
            ));
          }
        }
        order.updatedBy = userId;
        await order.save({ session });
      }
      invoice.status = PURCHASE_INVOICE_STATUS.CANCELLED;
      invoice.cancelledAt = new Date();
      invoice.updatedBy = userId;
      invoice.statusHistory.push(audit(
        'CANCELLED',
        fromStatus,
        PURCHASE_INVOICE_STATUS.CANCELLED,
        userId,
        note,
      ));
      await invoice.save({ session });
      return invoice;
    });
  }
  const invoice = await PurchaseInvoice.findOne({ _id: invoiceId, companyId });
  if (!invoice) throw fail('Purchase invoice not found', 404, 'PURCHASE_INVOICE_NOT_FOUND');
  const allowedFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
  if (!allowedFrom.includes(invoice.status)) {
    throw fail(
      `Cannot ${action} a purchase invoice in ${invoice.status} status`,
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }
  if (
    action === 'approve'
    && invoice.matchStatus === 'VARIANCE'
    && !asString(note)
  ) {
    throw fail(
      'Approval note is required when invoice variances exist',
      400,
      'VARIANCE_APPROVAL_NOTE_REQUIRED',
    );
  }
  const fromStatus = invoice.status;
  invoice.status = transition.to;
  invoice.updatedBy = userId;
  invoice.statusHistory.push(audit(
    action.toUpperCase(),
    fromStatus,
    transition.to,
    userId,
    note,
  ));
  if (action === 'approve') {
    invoice.approvedAt = new Date();
    invoice.approvedBy = userId;
  } else if (action === 'paid') {
    invoice.paidAt = new Date();
  }
  await invoice.save();
  return invoice;
}

export const PROCUREMENT_STATUSES = Object.freeze({
  purchaseOrders: Object.values(PURCHASE_ORDER_STATUS),
  goodsReceipts: Object.values(GOODS_RECEIPT_STATUS),
  purchaseReturns: Object.values(PURCHASE_RETURN_STATUS),
  purchaseInvoices: Object.values(PURCHASE_INVOICE_STATUS),
});
