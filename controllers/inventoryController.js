import mongoose from 'mongoose';
import { AppError, handleError } from '../utils/errorHandler.js';
import {
  getSnapshot,
  getLedger as getLedgerRows,
  receive as receiveStock,
  issue as issueStock,
  transfer as transferStock,
  adjust as adjustStock,
  reserveStock,
  releaseReservation,
  repack as repackStock,
} from '../services/inventoryService.js';

const fail = (message, statusCode = 400, code = 'INVENTORY_REQUEST_ERROR') =>
  new AppError(message, { statusCode, code });

const normalizeOptional = value => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

function companyIdFromRequest(req) {
  const companyId = req.user?.companyId;
  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw fail('A valid company is required', 401, 'COMPANY_REQUIRED');
  }
  return companyId;
}

function validateObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${field} is invalid`, 400, 'INVALID_ID');
  }
}

function parseDate(value, field) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fail(`${field} is invalid`, 400, 'INVALID_DATE');
  }
  return date;
}

function decodeLedgerCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const at = parseDate(decoded.at, 'cursor');
    validateObjectId(decoded._id, 'cursor');
    return { at, _id: decoded._id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw fail('cursor is invalid', 400, 'INVALID_CURSOR');
  }
}

function buildReadFilters(req) {
  const query = req.query || {};
  const snapshotFilter = { companyId: companyIdFromRequest(req) };
  const itemFilter = {};

  for (const field of ['itemId', 'warehouseId']) {
    if (!query[field]) continue;
    validateObjectId(query[field], field);
    snapshotFilter[field] = query[field];
  }
  for (const field of ['bin', 'batchNo']) {
    if (query[field] !== undefined) {
      snapshotFilter[field] = normalizeOptional(query[field]);
    }
  }
  if (query.uom) snapshotFilter.uom = String(query.uom).trim().toLowerCase();

  if (query.categoryKey) {
    const categoryKey = String(query.categoryKey).trim().toUpperCase();
    if (!['FG', 'RAW', 'PACKING', 'NC'].includes(categoryKey)) {
      throw fail('categoryKey must be FG, RAW, PACKING or NC');
    }
    snapshotFilter.categoryKey = categoryKey;
  }
  for (const field of ['productType', 'temperature', 'density', 'dimension', 'packing']) {
    if (!query[field]) continue;
    validateObjectId(query[field], field);
    if (field === 'productType') snapshotFilter.productType = query[field];
    else itemFilter[field] = query[field];
  }
  if (query.itemStatus) itemFilter.itemStatus = String(query.itemStatus).trim().toLowerCase();
  if (query.search) itemFilter.search = String(query.search).trim().slice(0, 160);

  return { snapshotFilter, itemFilter };
}

export async function getStock(req, res) {
  try {
    const { snapshotFilter, itemFilter } = buildReadFilters(req);
    const result = await getSnapshot(snapshotFilter, itemFilter, {
      limit: req.query?.limit,
      cursor: req.query?.cursor || null,
      includeZero: req.query?.includeZero === 'true',
      positiveOnly: req.query?.positiveOnly === 'true',
      reservedOnly: req.query?.reservedOnly === 'true',
    });
    return res.json({
      status: true,
      data: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getLedger(req, res) {
  try {
    const { snapshotFilter, itemFilter } = buildReadFilters(req);
    const filter = { ...snapshotFilter };
    const txnType = String(req.query?.txnType || '').trim().toUpperCase();
    if (txnType) {
      if (!['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST', 'REPACK'].includes(txnType)) {
        throw fail('txnType is invalid');
      }
      filter.txnType = txnType;
    }

    const result = await getLedgerRows(filter, {
      limit: req.query?.limit,
      cursor: decodeLedgerCursor(req.query?.cursor),
      from: parseDate(req.query?.from, 'from'),
      to: parseDate(req.query?.to, 'to'),
      search: String(req.query?.search || '').trim().slice(0, 160),
      itemFilter: {
        temperature: itemFilter.temperature,
        density: itemFilter.density,
        dimension: itemFilter.dimension,
        packing: itemFilter.packing,
        itemStatus: itemFilter.itemStatus,
      },
    });
    return res.json({
      status: true,
      data: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

function movementInput(req) {
  const body = req.body || {};
  const companyId = companyIdFromRequest(req);
  const itemId = body.itemId;
  const warehouseId = body.warehouseId;
  if (!itemId || !warehouseId) {
    throw fail('itemId and warehouseId are required');
  }
  validateObjectId(itemId, 'itemId');
  validateObjectId(warehouseId, 'warehouseId');

  return {
    companyId,
    itemId,
    warehouseId,
    qty: body.qty,
    uom: body.uom,
    by: req.user?.userId || req.user?.id || req.user?._id || null,
    note: String(body.note || '').trim(),
    bin: normalizeOptional(body.bin),
    batchNo: normalizeOptional(body.batchNo),
    refType: normalizeOptional(body.refType),
    refId: normalizeOptional(body.refId),
    requestId: normalizeOptional(body.requestId),
    at: body.at || null,
  };
}

export async function receive(req, res) {
  try {
    const result = await receiveStock(movementInput(req));
    return res.json({
      status: true,
      message: result.duplicate ? 'Receipt already posted' : 'Stock received',
      duplicate: result.duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function issue(req, res) {
  try {
    const result = await issueStock(movementInput(req));
    return res.json({
      status: true,
      message: result.duplicate ? 'Issue already posted' : 'Stock issued',
      duplicate: result.duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function adjust(req, res) {
  try {
    const input = movementInput(req);
    input.refType = input.refType || 'ADJUST';
    const result = await adjustStock(input);
    return res.json({
      status: true,
      message: result.duplicate ? 'Adjustment already posted' : 'Stock adjusted',
      duplicate: result.duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function transfer(req, res) {
  try {
    const body = req.body || {};
    const companyId = companyIdFromRequest(req);
    for (const field of ['itemId', 'fromWarehouseId', 'toWarehouseId']) {
      if (!body[field]) throw fail(`${field} is required`);
      validateObjectId(body[field], field);
    }

    const result = await transferStock({
      companyId,
      itemId: body.itemId,
      fromWarehouseId: body.fromWarehouseId,
      toWarehouseId: body.toWarehouseId,
      qty: body.qty,
      uom: body.uom,
      by: req.user?.userId || req.user?.id || req.user?._id || null,
      note: String(body.note || '').trim(),
      refId: normalizeOptional(body.refId),
      fromBin: normalizeOptional(body.fromBin ?? body.bin),
      toBin: normalizeOptional(body.toBin ?? body.bin),
      batchNo: normalizeOptional(body.batchNo),
      toBatchNo: normalizeOptional(body.toBatchNo ?? body.batchNo),
      requestId: normalizeOptional(body.requestId),
    });
    const duplicate = Boolean(result.out?.duplicate && result.in?.duplicate);
    return res.json({
      status: true,
      message: duplicate ? 'Transfer already posted' : 'Stock transferred',
      duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function repack(req, res) {
  try {
    const body = req.body || {};
    const companyId = companyIdFromRequest(req);
    for (const field of ['fromItemId', 'toItemId', 'warehouseId']) {
      if (!body[field]) throw fail(`${field} is required`);
      validateObjectId(body[field], field);
    }
    const result = await repackStock({
      companyId,
      fromItemId: body.fromItemId,
      toItemId: body.toItemId,
      warehouseId: body.warehouseId,
      qty: body.qty,
      uom: body.uom,
      by: req.user?.userId || req.user?.id || req.user?._id || null,
      note: String(body.note || '').trim(),
      refId: normalizeOptional(body.refId),
      bin: normalizeOptional(body.bin),
      batchNo: normalizeOptional(body.batchNo),
      requestId: normalizeOptional(body.requestId),
    });
    const duplicate = Boolean(result.out?.duplicate && result.in?.duplicate);
    return res.json({
      status: true,
      message: duplicate ? 'Packing change already posted' : 'Packing changed',
      duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function reserve(req, res) {
  try {
    const result = await reserveStock(movementInput(req));
    return res.json({
      status: true,
      message: result.duplicate ? 'Reservation already posted' : 'Stock reserved',
      duplicate: result.duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function release(req, res) {
  try {
    const result = await releaseReservation(movementInput(req));
    return res.json({
      status: true,
      message: result.duplicate
        ? 'Reservation release already posted'
        : 'Reservation released',
      duplicate: result.duplicate,
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export default {
  getStock,
  getLedger,
  receive,
  issue,
  adjust,
  transfer,
  repack,
  reserve,
  release,
};
