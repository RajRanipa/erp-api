import mongoose from 'mongoose';
import GoodsReceipt from '../models/GoodsReceipt.js';
import Item from '../models/Item.js';
import Party from '../models/Party.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseOrder, { PURCHASE_ORDER_STATUS } from '../models/PurchaseOrder.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Warehouse from '../models/Warehouse.js';
import {
  cancelGoodsReceipt,
  cancelPurchaseReturn,
  createGoodsReceipt,
  createPurchaseInvoice,
  createPurchaseOrder,
  createPurchaseReturn,
  postGoodsReceipt,
  postPurchaseReturn,
  PROCUREMENT_STATUSES,
  transitionPurchaseInvoice,
  transitionPurchaseOrder,
  updateGoodsReceipt,
  updatePurchaseInvoice,
  updatePurchaseOrder,
  updatePurchaseReturn,
  verifyPurchaseInvoice,
  resolveGoodsReceiptInspection,
} from '../services/procurementService.js';
import { AppError } from '../utils/errorHandler.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';

const actorId = req => req.user?.userId || req.user?._id || req.user?.id || null;

function companyIdFrom(req) {
  const companyId = req.user?.companyId;
  if (!companyId) {
    throw new AppError('A company context is required', {
      statusCode: 401,
      code: 'COMPANY_REQUIRED',
    });
  }
  return companyId;
}

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function listOptions(query = {}) {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.limit) || 25)));
  return { page, limit, skip: (page - 1) * limit };
}

function parseDateBoundary(value, field, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} is invalid`, {
      statusCode: 400,
      code: 'INVALID_DATE',
      details: { field },
    });
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function validateOptionalId(value, field) {
  if (value && !mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} is invalid`, {
      statusCode: 400,
      code: 'INVALID_ID',
      details: { field },
    });
  }
}

function buildFilter(companyId, query, {
  statuses,
  dateField,
  searchFields,
  relations = {},
}) {
  const filter = { companyId };
  if (query.status) {
    const status = String(query.status).trim().toUpperCase();
    if (!statuses.includes(status)) {
      throw new AppError('status is invalid', {
        statusCode: 400,
        code: 'INVALID_STATUS',
        details: { allowed: statuses },
      });
    }
    filter.status = status;
  }
  for (const [queryField, dbField] of Object.entries(relations)) {
    if (query[queryField]) {
      validateOptionalId(query[queryField], queryField);
      filter[dbField] = query[queryField];
    }
  }
  const from = parseDateBoundary(query.from, 'from');
  const to = parseDateBoundary(query.to, 'to', true);
  if (from || to) {
    filter[dateField] = {};
    if (from) filter[dateField].$gte = from;
    if (to) filter[dateField].$lte = to;
  }
  const search = String(query.search || '').trim().slice(0, 100);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = searchFields.map(field => ({ [field]: regex }));
  }
  return filter;
}

async function addSupplierSearch(filter, companyId, searchValue) {
  const search = String(searchValue || '').trim().slice(0, 100);
  if (!search) return;
  const regex = new RegExp(`^${escapeRegex(search)}`, 'i');
  const suppliers = await Party.find({
    companyId,
    roles: 'SUPPLIER',
    $or: [{ code: regex }, { name: regex }, { legalName: regex }],
  }).select('_id').limit(100).lean();
  if (suppliers.length) {
    filter.$or ||= [];
    filter.$or.push({ supplierId: { $in: suppliers.map(row => row._id) } });
  }
}

async function paginatedList({
  Model,
  filter,
  query,
  dateField,
  select,
  populate = [],
}) {
  const { page, limit, skip } = listOptions(query);
  let rowsQuery = Model.find(filter)
    .select(select)
    .sort({ [dateField]: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  for (const population of populate) rowsQuery = rowsQuery.populate(population);
  const [rows, total] = await Promise.all([
    rowsQuery,
    Model.countDocuments(filter),
  ]);
  return {
    rows,
    meta: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
}

async function findTenantDocument(Model, id, companyId, populate = []) {
  validateOptionalId(id, 'id');
  let query = Model.findOne({ _id: id, companyId });
  for (const population of populate) query = query.populate(population);
  return query.lean();
}

const supplierPopulate = {
  path: 'supplierId',
  select: 'code name legalName status roles phone email taxProfile.taxId',
};
const warehousePopulate = {
  path: 'warehouseId',
  select: 'code name address state pincode status',
};
const actorPopulate = [
  { path: 'createdBy', select: 'fullName email' },
  { path: 'updatedBy', select: 'fullName email' },
];

export async function getProcurementLookups(req, res) {
  const companyId = companyIdFrom(req);
  const type = String(req.params.type || '').trim().toLowerCase();
  const search = String(req.query.q || '').trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 50)));
  const regex = search ? new RegExp(escapeRegex(search), 'i') : null;
  let rows;

  if (type === 'suppliers') {
    const filter = { companyId, status: 'active', roles: 'SUPPLIER' };
    if (regex) filter.$or = [{ code: regex }, { name: regex }, { legalName: regex }];
    rows = await Party.find(filter)
      .select('code name legalName currency paymentTerms taxProfile.taxId')
      .sort({ name: 1, _id: 1 })
      .limit(limit)
      .lean();
  } else if (type === 'warehouses') {
    const filter = { companyId, status: 'active' };
    if (regex) filter.$or = [{ code: regex }, { name: regex }, { state: regex }];
    rows = await Warehouse.find(filter)
      .select('code name address state pincode')
      .sort({ name: 1, _id: 1 })
      .limit(limit)
      .lean();
  } else if (type === 'items') {
    const filter = {
      companyId,
      status: 'active',
      categoryKey: { $in: ['RAW', 'PACKING', 'FG'] },
    };
    if (regex) filter.$or = [{ sku: regex }, { name: regex }, { grade: regex }];
    rows = await Item.find(filter)
      .select('sku name grade categoryKey UOM purchasePrice')
      .sort({ categoryKey: 1, name: 1, _id: 1 })
      .limit(limit)
      .lean();
  } else {
    throw new AppError('Lookup type is invalid', {
      statusCode: 400,
      code: 'INVALID_LOOKUP_TYPE',
      details: { allowed: ['suppliers', 'warehouses', 'items'] },
    });
  }
  return sendSuccess(res, { data: rows });
}

export async function getProcurementSummary(req, res) {
  const companyId = new mongoose.Types.ObjectId(companyIdFrom(req));
  const now = new Date();
  const [orderSummary, receiptSummary, returnSummary, invoiceSummary] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { companyId } },
      {
        $facet: {
          statuses: [{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$totals.grandTotal' } } }],
          overdue: [
            {
              $match: {
                expectedDeliveryDate: { $lt: now },
                status: {
                  $in: [
                    PURCHASE_ORDER_STATUS.APPROVED,
                    PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          openValue: [
            {
              $match: {
                status: {
                  $in: [
                    PURCHASE_ORDER_STATUS.PENDING_APPROVAL,
                    PURCHASE_ORDER_STATUS.APPROVED,
                    PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
                  ],
                },
              },
            },
            { $group: { _id: null, value: { $sum: '$totals.grandTotal' } } },
          ],
        },
      },
    ]),
    GoodsReceipt.aggregate([
      { $match: { companyId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    PurchaseReturn.aggregate([
      { $match: { companyId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    PurchaseInvoice.aggregate([
      { $match: { companyId } },
      {
        $facet: {
          statuses: [{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$totals.grandTotal' } } }],
          due: [
            {
              $match: {
                dueDate: { $lt: now },
                status: { $in: ['VERIFIED', 'APPROVED'] },
              },
            },
            { $count: 'count' },
          ],
          variances: [
            { $match: { matchStatus: 'VARIANCE', status: { $ne: 'CANCELLED' } } },
            { $count: 'count' },
          ],
        },
      },
    ]),
  ]);
  const toObject = rows => Object.fromEntries(
    (rows || []).map(row => [row._id, { count: row.count, value: row.value || 0 }]),
  );
  return sendSuccess(res, {
    data: {
      orders: toObject(orderSummary[0]?.statuses),
      receipts: toObject(receiptSummary),
      returns: toObject(returnSummary),
      invoices: toObject(invoiceSummary[0]?.statuses),
      openOrderValue: orderSummary[0]?.openValue?.[0]?.value || 0,
      overdueOrders: orderSummary[0]?.overdue?.[0]?.count || 0,
      overdueInvoices: invoiceSummary[0]?.due?.[0]?.count || 0,
      invoiceVariances: invoiceSummary[0]?.variances?.[0]?.count || 0,
    },
  });
}

export async function listPurchaseOrders(req, res) {
  const companyId = companyIdFrom(req);
  const filter = buildFilter(companyId, req.query, {
    statuses: PROCUREMENT_STATUSES.purchaseOrders,
    dateField: 'orderDate',
    searchFields: [
      'poNumber',
      'supplierSnapshot.code',
      'supplierSnapshot.name',
      'internalReference',
    ],
    relations: { supplierId: 'supplierId', warehouseId: 'warehouseId' },
  });
  await addSupplierSearch(filter, companyId, req.query.search);
  const result = await paginatedList({
    Model: PurchaseOrder,
    filter,
    query: req.query,
    dateField: 'orderDate',
    select: 'poNumber supplierId supplierSnapshot warehouseId orderDate expectedDeliveryDate currency totals status lines createdAt updatedAt',
    populate: [supplierPopulate, warehousePopulate],
  });
  return sendSuccess(res, { data: result.rows, meta: result.meta });
}

export async function getPurchaseOrder(req, res) {
  const order = await findTenantDocument(
    PurchaseOrder,
    req.params.id,
    companyIdFrom(req),
    [
      supplierPopulate,
      warehousePopulate,
      ...actorPopulate,
      { path: 'submittedBy approvedBy', select: 'fullName email' },
      { path: 'statusHistory.by', select: 'fullName email' },
    ],
  );
  if (!order) {
    throw new AppError('Purchase order not found', {
      statusCode: 404,
      code: 'PURCHASE_ORDER_NOT_FOUND',
    });
  }
  return sendSuccess(res, { data: order });
}

export async function createOrder(req, res) {
  const order = await createPurchaseOrder({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    body: req.body || {},
  });
  return sendCreated(res, {
    data: order,
    message: `Purchase order ${order.poNumber} created`,
  });
}

export async function updateOrder(req, res) {
  const order = await updatePurchaseOrder({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    orderId: req.params.id,
    body: req.body || {},
  });
  return sendSuccess(res, {
    data: order,
    message: `Purchase order ${order.poNumber} updated`,
  });
}

function orderAction(action) {
  return async (req, res) => {
    const order = await transitionPurchaseOrder({
      companyId: companyIdFrom(req),
      userId: actorId(req),
      orderId: req.params.id,
      action,
      note: req.body?.note,
    });
    return sendSuccess(res, {
      data: order,
      message: {
        submit: 'Purchase order submitted for approval',
        approve: 'Purchase order approved',
        reject: 'Purchase order rejected',
        close: 'Purchase order closed',
        cancel: 'Purchase order cancelled',
      }[action],
    });
  };
}

export const submitOrder = orderAction('submit');
export const approveOrder = orderAction('approve');
export const rejectOrder = orderAction('reject');
export const closeOrder = orderAction('close');
export const cancelOrder = orderAction('cancel');

export async function listGoodsReceipts(req, res) {
  const companyId = companyIdFrom(req);
  const filter = buildFilter(companyId, req.query, {
    statuses: PROCUREMENT_STATUSES.goodsReceipts,
    dateField: 'receivedAt',
    searchFields: ['grnNumber', 'supplierInvoiceNo', 'deliveryChallanNo', 'vehicleNo'],
    relations: {
      supplierId: 'supplierId',
      warehouseId: 'warehouseId',
      purchaseOrderId: 'purchaseOrderId',
    },
  });
  await addSupplierSearch(filter, companyId, req.query.search);
  const result = await paginatedList({
    Model: GoodsReceipt,
    filter,
    query: req.query,
    dateField: 'receivedAt',
    select: 'grnNumber purchaseOrderId supplierId warehouseId receivedAt supplierInvoiceNo deliveryChallanNo lines status postedAt createdAt',
    populate: [
      supplierPopulate,
      warehousePopulate,
      { path: 'purchaseOrderId', select: 'poNumber status' },
    ],
  });
  return sendSuccess(res, { data: result.rows, meta: result.meta });
}

export async function getGoodsReceipt(req, res) {
  const receipt = await findTenantDocument(
    GoodsReceipt,
    req.params.id,
    companyIdFrom(req),
    [
      supplierPopulate,
      warehousePopulate,
      { path: 'purchaseOrderId', select: 'poNumber status totals supplierSnapshot' },
      ...actorPopulate,
      { path: 'postedBy statusHistory.by', select: 'fullName email' },
    ],
  );
  if (!receipt) {
    throw new AppError('Goods receipt not found', {
      statusCode: 404,
      code: 'GOODS_RECEIPT_NOT_FOUND',
    });
  }
  return sendSuccess(res, { data: receipt });
}

export async function createReceipt(req, res) {
  const receipt = await createGoodsReceipt({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    body: req.body || {},
  });
  return sendCreated(res, {
    data: receipt,
    message: `Goods receipt ${receipt.grnNumber} saved as draft`,
  });
}

export async function updateReceipt(req, res) {
  const receipt = await updateGoodsReceipt({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    receiptId: req.params.id,
    body: req.body || {},
  });
  return sendSuccess(res, {
    data: receipt,
    message: `Goods receipt ${receipt.grnNumber} updated`,
  });
}

export async function postReceipt(req, res) {
  const receipt = await postGoodsReceipt({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    receiptId: req.params.id,
  });
  return sendSuccess(res, {
    data: receipt,
    message: `Goods receipt ${receipt.grnNumber} posted to inventory`,
  });
}

export async function resolveReceiptInspection(req, res) {
  const receipt = await resolveGoodsReceiptInspection({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    receiptId: req.params.id,
    body: req.body || {},
  });
  return sendSuccess(res, {
    data: receipt,
    message: `Quarantine inspection resolved for ${receipt.grnNumber}`,
  });
}

export async function cancelReceipt(req, res) {
  const receipt = await cancelGoodsReceipt({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    receiptId: req.params.id,
    note: req.body?.note,
  });
  return sendSuccess(res, { data: receipt, message: 'Goods receipt cancelled' });
}

export async function listPurchaseReturns(req, res) {
  const companyId = companyIdFrom(req);
  const filter = buildFilter(companyId, req.query, {
    statuses: PROCUREMENT_STATUSES.purchaseReturns,
    dateField: 'returnDate',
    searchFields: ['returnNumber', 'supplierCreditNoteNo'],
    relations: {
      supplierId: 'supplierId',
      warehouseId: 'warehouseId',
      purchaseOrderId: 'purchaseOrderId',
      goodsReceiptId: 'goodsReceiptId',
    },
  });
  await addSupplierSearch(filter, companyId, req.query.search);
  const result = await paginatedList({
    Model: PurchaseReturn,
    filter,
    query: req.query,
    dateField: 'returnDate',
    select: 'returnNumber purchaseOrderId goodsReceiptId supplierId warehouseId returnDate supplierCreditNoteNo lines status postedAt createdAt',
    populate: [
      supplierPopulate,
      warehousePopulate,
      { path: 'purchaseOrderId', select: 'poNumber status' },
      { path: 'goodsReceiptId', select: 'grnNumber status' },
    ],
  });
  return sendSuccess(res, { data: result.rows, meta: result.meta });
}

export async function getPurchaseReturn(req, res) {
  const purchaseReturn = await findTenantDocument(
    PurchaseReturn,
    req.params.id,
    companyIdFrom(req),
    [
      supplierPopulate,
      warehousePopulate,
      { path: 'purchaseOrderId', select: 'poNumber status' },
      { path: 'goodsReceiptId', select: 'grnNumber status' },
      ...actorPopulate,
      { path: 'postedBy statusHistory.by', select: 'fullName email' },
    ],
  );
  if (!purchaseReturn) {
    throw new AppError('Purchase return not found', {
      statusCode: 404,
      code: 'PURCHASE_RETURN_NOT_FOUND',
    });
  }
  return sendSuccess(res, { data: purchaseReturn });
}

export async function createReturn(req, res) {
  const purchaseReturn = await createPurchaseReturn({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    body: req.body || {},
  });
  return sendCreated(res, {
    data: purchaseReturn,
    message: `Purchase return ${purchaseReturn.returnNumber} saved as draft`,
  });
}

export async function updateReturn(req, res) {
  const purchaseReturn = await updatePurchaseReturn({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    returnId: req.params.id,
    body: req.body || {},
  });
  return sendSuccess(res, {
    data: purchaseReturn,
    message: `Purchase return ${purchaseReturn.returnNumber} updated`,
  });
}

export async function postReturn(req, res) {
  const purchaseReturn = await postPurchaseReturn({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    returnId: req.params.id,
  });
  return sendSuccess(res, {
    data: purchaseReturn,
    message: `Purchase return ${purchaseReturn.returnNumber} posted to inventory`,
  });
}

export async function cancelReturn(req, res) {
  const purchaseReturn = await cancelPurchaseReturn({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    returnId: req.params.id,
    note: req.body?.note,
  });
  return sendSuccess(res, { data: purchaseReturn, message: 'Purchase return cancelled' });
}

export async function listPurchaseInvoices(req, res) {
  const companyId = companyIdFrom(req);
  const filter = buildFilter(companyId, req.query, {
    statuses: PROCUREMENT_STATUSES.purchaseInvoices,
    dateField: 'invoiceDate',
    searchFields: ['invoiceNumber', 'supplierInvoiceNumber'],
    relations: { supplierId: 'supplierId', purchaseOrderId: 'purchaseOrderId' },
  });
  await addSupplierSearch(filter, companyId, req.query.search);
  if (req.query.matchStatus) {
    const matchStatus = String(req.query.matchStatus).toUpperCase();
    if (!['NOT_CHECKED', 'MATCHED', 'VARIANCE'].includes(matchStatus)) {
      throw new AppError('matchStatus is invalid', {
        statusCode: 400,
        code: 'INVALID_MATCH_STATUS',
      });
    }
    filter.matchStatus = matchStatus;
  }
  const result = await paginatedList({
    Model: PurchaseInvoice,
    filter,
    query: req.query,
    dateField: 'invoiceDate',
    select: 'invoiceNumber supplierInvoiceNumber purchaseOrderId supplierId invoiceDate dueDate currency totals matchStatus variances status createdAt',
    populate: [
      supplierPopulate,
      { path: 'purchaseOrderId', select: 'poNumber status' },
    ],
  });
  return sendSuccess(res, { data: result.rows, meta: result.meta });
}

export async function getPurchaseInvoice(req, res) {
  const invoice = await findTenantDocument(
    PurchaseInvoice,
    req.params.id,
    companyIdFrom(req),
    [
      supplierPopulate,
      { path: 'purchaseOrderId', select: 'poNumber status totals supplierSnapshot' },
      { path: 'goodsReceiptIds', select: 'grnNumber status receivedAt' },
      ...actorPopulate,
      { path: 'verifiedBy approvedBy statusHistory.by', select: 'fullName email' },
    ],
  );
  if (!invoice) {
    throw new AppError('Purchase invoice not found', {
      statusCode: 404,
      code: 'PURCHASE_INVOICE_NOT_FOUND',
    });
  }
  return sendSuccess(res, { data: invoice });
}

export async function createInvoice(req, res) {
  const invoice = await createPurchaseInvoice({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    body: req.body || {},
  });
  return sendCreated(res, {
    data: invoice,
    message: `Purchase invoice ${invoice.invoiceNumber} saved as draft`,
  });
}

export async function updateInvoice(req, res) {
  const invoice = await updatePurchaseInvoice({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    invoiceId: req.params.id,
    body: req.body || {},
  });
  return sendSuccess(res, {
    data: invoice,
    message: `Purchase invoice ${invoice.invoiceNumber} updated`,
  });
}

export async function verifyInvoice(req, res) {
  const invoice = await verifyPurchaseInvoice({
    companyId: companyIdFrom(req),
    userId: actorId(req),
    invoiceId: req.params.id,
  });
  return sendSuccess(res, {
    data: invoice,
    message: invoice.matchStatus === 'MATCHED'
      ? 'Three-way match passed'
      : `Invoice verified with ${invoice.variances.length} variance(s)`,
  });
}

function invoiceAction(action) {
  return async (req, res) => {
    const invoice = await transitionPurchaseInvoice({
      companyId: companyIdFrom(req),
      userId: actorId(req),
      invoiceId: req.params.id,
      action,
      note: req.body?.note,
    });
    return sendSuccess(res, {
      data: invoice,
      message: `Purchase invoice ${action} action completed`,
    });
  };
}

export const approveInvoice = invoiceAction('approve');
export const markInvoicePaid = invoiceAction('paid');
export const cancelInvoice = invoiceAction('cancel');
