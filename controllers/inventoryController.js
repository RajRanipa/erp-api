// backend-api/controllers/inventoryController.js
import { handleError } from '../utils/errorHandler.js';
import {
  getSnapshot,
  getLedger as svcGetLedger,
  receive as svcReceive,
  issue as svcIssue,
  transfer as svcTransfer,
  adjust as svcAdjust,
  reserveStock as svcReserve,
  releaseReservation as svcRelease,
  repack as svcRepack,
} from '../services/inventoryService.js';

/**
 * Build a Mongo filter for snapshot/ledger reads from query params.
 */
function buildCommonFilter(req) {
  const { itemId, warehouseId, bin, batchNo, uom, categoryKey, productType, temperature, density, dimension, packing } = req.query || {};
  const filter = { companyId: req.user?.companyId };
  if (itemId) filter.itemId = itemId;
  if (warehouseId) filter.warehouseId = warehouseId;
  if (typeof bin !== 'undefined') filter.bin = bin || null;
  if (typeof batchNo !== 'undefined') filter.batchNo = batchNo || null;
  if (uom) filter.uom = uom;
  if (categoryKey) filter.categoryKey = categoryKey;
  if (productType) filter.productType = productType;
  if (temperature) filter.temperature = temperature;
  if (density) filter.density = density;
  if (dimension) filter.dimension = dimension;
  if (packing) filter.packing = packing;
  return filter;
}

/**
 * GET /inventory/stock
 * Returns InventorySnapshot rows (fast balances)
 */
export async function getStock(req, res) {
  try {
    const filter = buildCommonFilter(req);
    // const { categoryKey, productType, temperature, density, dimension, packing } = req.query || {};
    const {
      categoryKey,
      productType,
      temperature,
      density,
      dimension,
      packing,
      ...snapFilter
    } = filter;
    console.log('snapFilter', snapFilter, {
      categoryKey,
      productType,
      temperature,
      density,
      dimension,
      packing,
    });
    const rows = await getSnapshot(snapFilter, {
      categoryKey,
      productType,
      temperature,
      density,
      dimension,
      packing,
    });

    console.log("inventory stock controller called ", rows[0]);
    res.json({ status: true, data: rows });
  } catch (err) {
    handleError(res, err, 'Failed to fetch stock snapshot');
  }
}

/**
 * GET /inventory/ledger
 * Returns InventoryLedger rows (movements)
 * Optional query: limit, sort, from, to (date range)
 */
export async function getLedger(req, res) {
  try {
    const filter = buildCommonFilter(req);
    const { limit = 100, from, to } = req.query || {};
    if (from || to) {
      filter.at = {};
      if (from) filter.at.$gte = new Date(from);
      if (to) filter.at.$lte = new Date(to);
    }
    const rows = await svcGetLedger(filter, { limit: Number(limit), sort: { at: -1 } });
    res.json({ status: true, data: rows });
  } catch (err) {
    handleError(res, err, 'Failed to fetch stock ledger');
  }
}

/**
 * POST /inventory/receipt
 * Body: { itemId, warehouseId, qty, uom, note?, bin?, batchNo?, refType?, refId? }
 */
export async function receive(req, res) {
  try {
    console.log("inventory receive controller called ", req.body);
    const { itemId, warehouseId, qty, uom, note = '', bin = null, batchNo = null, refType = null, refId = null } = req.body || {};
    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !warehouseId || !uom) throw new Error('itemId, warehouseId, uom are required');
    const result = await svcReceive({
      companyId, itemId, warehouseId, uom,
      qty, by: userId, note, bin, batchNo, refType, refId
    });
    console.log("result", result);
    res.json({ status: true, message: 'Stock received', data: result });
  } catch (err) {
    handleError(res, err, 'Failed to receive stock');
  }
}

/**
 * POST /inventory/issue
 * Body: { itemId, warehouseId, qty, uom, note?, bin?, batchNo?, refType?, refId? }
 */
export async function issue(req, res) {
  try {
    const { itemId, warehouseId, qty, uom, note = '', bin = null, batchNo = null, refType = null, refId = null } = req.body || {};
    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !warehouseId || !uom) throw new Error('itemId, warehouseId, uom are required');
    const result = await svcIssue({
      companyId, itemId, warehouseId, uom,
      qty, by: userId, note, bin, batchNo, refType, refId
    });
    res.json({ status: true, message: 'Stock issued', data: result });
  } catch (err) {
    handleError(res, err, 'Failed to issue stock');
  }
}

/**
 * POST /inventory/adjust
 * Body: { itemId, warehouseId, qty(±), uom, note?, bin?, batchNo?, refType?, refId? }
 */
export async function adjust(req, res) {
  try {
    const { itemId, warehouseId, qty, uom, note = '', bin = null, batchNo = null, refType = 'ADJUST', refId = null } = req.body || {};
    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !warehouseId || !uom) throw new Error('itemId, warehouseId, uom are required');
    const result = await svcAdjust({
      companyId, itemId, warehouseId, uom,
      qty, by: userId, note, bin, batchNo, refType, refId
    });
    res.json({ status: true, message: 'Stock adjusted', data: result });
  } catch (err) {
    handleError(res, err, 'Failed to adjust stock');
  }
}

/**
 * POST /inventory/transfer
 * Body: { itemId, fromWarehouseId, toWarehouseId, qty, uom, note?, bin?, batchNo?, refId? }
 */
export async function transfer(req, res) {
  try {
    const { itemId, fromWarehouseId, toWarehouseId, qty, uom, note = '', bin = null, batchNo = null, refId = null } = req.body || {};
    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !fromWarehouseId || !toWarehouseId || !uom) throw new Error('itemId, fromWarehouseId, toWarehouseId, uom are required');
    const result = await svcTransfer({
      companyId, itemId, fromWarehouseId, toWarehouseId, uom,
      qty, by: userId, note, refType: 'TRANSFER', refId, bin, batchNo
    });
    res.json({ status: true, message: 'Stock transferred', data: result });
  } catch (err) {
    handleError(res, err, 'Failed to transfer stock');
  }
}

/**
 * POST /inventory/repack
 * Convert stock from one packing-variant item to another (same productType)
 * Body: { fromItemId, toItemId, warehouseId, qty, uom, note?, bin?, batchNo?, refId? }
 */
export async function repack(req, res) {
  try {
    const {
      fromItemId,
      toItemId,
      warehouseId,
      qty,
      uom,
      note = '',
      bin = null,
      batchNo = null,
      refId = null,
    } = req.body || {};

    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!fromItemId || !toItemId || !warehouseId || !uom) {
      throw new Error('fromItemId, toItemId, warehouseId, uom are required');
    }

    const result = await svcRepack({
      companyId,
      fromItemId,
      toItemId,
      warehouseId,
      qty,
      uom,
      by: userId,
      note,
      refId,
      bin,
      batchNo,
    });

    res.json({ status: true, message: 'Packing changed', data: result });
  } catch (err) {
    handleError(res, err, 'Failed to repack');
  }
}

/**
 * POST /inventory/reserve
 * Body: { itemId, warehouseId, qty, uom, bin?, batchNo? }
 */
export async function reserve(req, res) {
  try {
    const { itemId, warehouseId, qty, uom, bin = null, batchNo = null } = req.body || {};
    const { companyId, _id: userId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !warehouseId || !uom) throw new Error('itemId, warehouseId, uom are required');
    const snap = await svcReserve({ companyId, itemId, warehouseId, uom, qty, bin, batchNo, by: userId });
    res.json({ status: true, message: 'Stock reserved', data: snap });
  } catch (err) {
    handleError(res, err, 'Failed to reserve stock');
  }
}

/**
 * POST /inventory/release
 * Body: { itemId, warehouseId, qty, uom, bin?, batchNo? }
 */
export async function release(req, res) {
  try {
    const { itemId, warehouseId, qty, uom, bin = null, batchNo = null } = req.body || {};
    const { companyId } = req.user || {};
    if (!companyId) throw new Error('Missing companyId on user');
    if (!itemId || !warehouseId || !uom) throw new Error('itemId, warehouseId, uom are required');
    const snap = await svcRelease({ companyId, itemId, warehouseId, uom, qty, bin, batchNo });
    res.json({ status: true, message: 'Reservation released', data: snap });
  } catch (err) {
    handleError(res, err, 'Failed to release reservation');
  }
}

const inventoryController = {
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

export default inventoryController;