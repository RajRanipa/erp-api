// backend-api/services/inventoryService.js
import mongoose from 'mongoose';
import InventoryLedger from '../models/InventoryLedger.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import Item from '../models/Item.js';

/**
 * Inventory Service
 * Single source of truth for all stock changes.
 * Always go through this layer (not directly controller→model).
 */

const asNumber = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Quantity must be a finite number');
  return n;
};

async function getProductType(itemId) {
  const item = await Item.findById(itemId).select('productType').lean();
  // console.log('item getProductType -- > ', item, itemId);
  if (!item) throw new Error('Item not found');
  return item.productType;
}

async function getItemLite(itemId) {
  const item = await Item.findById(itemId).select('_id productType UOM').lean();
  if (!item) throw new Error('Item not found');
  return item;
}

/**
 * Ensure we never take stock below zero (configurable).
 * Returns current available for the bucket.
 */
async function getCurrentBalances({ companyId, itemId, warehouseId, uom, bin = null, batchNo = null }, session) {
  const productType = await getProductType(itemId);
  const snap = await InventorySnapshot.findOne(
    { companyId, itemId, productType, warehouseId, uom, bin, batchNo },
    null,
    session ? { session } : undefined
  ).lean();
  console.log("getCurrentBalances snap", snap);
  return {
    onHand: snap?.onHand ?? 0,
    reserved: snap?.reserved ?? 0,
    available: (snap?.onHand ?? 0) - (snap?.reserved ?? 0),
  };
}

/**
 * Core primitive to post a single movement (signed qty).
 * - Writes ledger (append-only)
 * - Updates snapshot.onHand
 * - Optionally enforces non-negative onHand after movement
 */
export async function postMovement({
  companyId,
  itemId,
  warehouseId,
  uom,
  qty,                 // signed: +receipt/transfer-in/adjust+, -issue/transfer-out/adjust-
  txnType,             // 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'ADJUST' | 'REPACK'
  by,                  // userId
  note = '',
  refType = null,
  refId = null,
  bin = null,
  batchNo = null,
  enforceNonNegative = true,
  session: extSession, // optional external session
}) {
  const session = extSession || (await mongoose.startSession());
  let createdSession = false;
  if (!extSession) {
    createdSession = true;
    session.startTransaction();
  }
  console.log("postMovement",
    {
      "companyId" :companyId,
      "itemId" :itemId,
      "warehouseId" :warehouseId,
      "uom" :uom,
      "qty" :qty,
      "txnType" :txnType,
      "by" :by,
      "note" :note,
      "refType" :refType,
      "refId" :refId,
      "bin" :bin,
      "batchNo" :batchNo,
      "enforceNonNegative" :enforceNonNegative,
      "session: extSession" :session
    }
  );

  try {
    const signedQty = asNumber(qty);
    if (signedQty === 0) throw new Error('Quantity cannot be zero');
    if (!['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST', 'REPACK'].includes(txnType)) {
      throw new Error('Invalid txnType');
    }
    const productType = await getProductType(itemId);
    console.log("productType", productType);
    console.log("enforceNonNegative", enforceNonNegative);
    // If enforcing non-negative, pre-check (for decreases)
    if (enforceNonNegative && signedQty < 0) {
      const { onHand } = await getCurrentBalances({ companyId, itemId, warehouseId, uom, bin, batchNo }, session);
      console.log("onHand", onHand);
      console.log("signedQty", signedQty);
      if (onHand + signedQty < 0) {
        throw new Error('Insufficient stock: onHand would go below zero');
      }
    }
    console.log('postMovement signedQty by', by);
    // 1) Write ledger row
    const [ledger] = await InventoryLedger.create([{
      companyId, itemId, productType, warehouseId, bin, batchNo,
      uom, quantity: signedQty, txnType, refType, refId, note, by, at: new Date(),
    }], { session });

    console.log("ledger", ledger);
    // 2) Update snapshot (onHand)
    const snapshot = await InventorySnapshot.incOnHand(
      { companyId, itemId, productType, warehouseId, uom, bin, batchNo },
      signedQty,
      session
    );
    console.log("postMovement snapshot", snapshot);

    if (!extSession) {
      await session.commitTransaction();
      session.endSession();
    }

    return { ledger, snapshot };
  } catch (err) {
    if (!extSession) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
}

/**
 * Convenience wrappers (ensure correct signs)
 */
export async function receive(params) {
  // expects: qty > 0
  const qty = Math.abs(asNumber(params.qty));
  console.log("receive qty - ", qty);
  return postMovement({ ...params, qty, txnType: 'RECEIPT' });
}

export async function issue(params) {
  // expects: qty > 0 (we convert to negative)
  const qty = -Math.abs(asNumber(params.qty));
  // console.log("qty", qty);
  return postMovement({ ...params, qty, txnType: 'ISSUE' });
}

export async function adjust(params) {
  // qty can be +/-; caller decides
  const qty = asNumber(params.qty);
  if (qty === 0) throw new Error('Quantity cannot be zero');
  return postMovement({ ...params, qty, txnType: 'ADJUST' });
}

/**
 * Transfer between warehouses within one DB transaction
 */
export async function transfer({
  companyId,
  itemId,
  fromWarehouseId,
  toWarehouseId,
  uom,
  qty,                 // positive input
  by,
  note = '',
  refType = 'TRANSFER',
  refId = null,
  bin = null,
  batchNo = null,
  enforceNonNegative = true,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const q = Math.abs(asNumber(qty));
    if (!q) throw new Error('Quantity required for transfer');

    // OUT from source
    const outRes = await postMovement({
      companyId, itemId, warehouseId: fromWarehouseId,
      uom, qty: -q, txnType: 'TRANSFER', by, note,
      refType, refId, bin, batchNo,
      enforceNonNegative,
      session,
    });

    // IN to destination
    const inRes = await postMovement({
      companyId, itemId, warehouseId: toWarehouseId,
      uom, qty: +q, txnType: 'TRANSFER', by, note,
      refType, refId, bin, batchNo,
      enforceNonNegative: false, // inbound never needs non-negative check
      session,
    });

    await session.commitTransaction();
    session.endSession();
    return { out: outRes, in: inRes };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * Reservation helpers (optional use in order workflow)
 */
export async function reserveStock({
  companyId, itemId, warehouseId, uom, qty, by, bin = null, batchNo = null, session: extSession,
}) {
  const session = extSession || (await mongoose.startSession());
  let createdSession = false;
  if (!extSession) {
    createdSession = true;
    session.startTransaction();
  }

  try {
    const productType = await getProductType(itemId);
    const q = Math.abs(asNumber(qty));
    // Enforce availability (onHand - reserved) >= qty
    const { available } = await getCurrentBalances({ companyId, itemId, warehouseId, uom, bin, batchNo }, session);
    if (available < q) throw new Error('Insufficient available stock to reserve');

    const snap = await InventorySnapshot.incReserved(
      { companyId, itemId, productType, warehouseId, uom, bin, batchNo },
      +q,
      session
    );
    console.log("reserveStock snap", snap);

    if (createdSession) {
      await session.commitTransaction();
      session.endSession();
    }
    return snap;
  } catch (err) {
    if (createdSession) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
}

export async function releaseReservation({
  companyId, itemId, warehouseId, uom, qty, bin = null, batchNo = null, session: extSession,
}) {
  const session = extSession || (await mongoose.startSession());
  let createdSession = false;
  if (!extSession) {
    createdSession = true;
    session.startTransaction();
  }

  try {
    const productType = await getProductType(itemId);
    const q = Math.abs(asNumber(qty));
    const snap = await InventorySnapshot.incReserved(
      { companyId, itemId, productType, warehouseId, uom, bin, batchNo },
      -q,
      session
    );
    console.log("releaseReservation snap", snap);
    if (createdSession) {
      await session.commitTransaction();
      session.endSession();
    }
    return snap;
  } catch (err) {
    if (createdSession) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
}

/**
 * Repack: convert stock from one packing-variant item to another (same base product).
 * - Decrease (ISSUE) fromItemId
 * - Increase (RECEIPT) toItemId
 * - Both within one DB transaction
 */
export async function repack({
  companyId,
  fromItemId,
  toItemId,
  warehouseId,
  qty,
  uom,
  by,
  note = '',
  refType = 'REPACK',
  refId = null,
  bin = null,
  batchNo = null,
  enforceNonNegative = true,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const q = Math.abs(asNumber(qty));
    if (!q) throw new Error('Quantity required for repack');
    if (!fromItemId || !toItemId) throw new Error('fromItemId and toItemId are required');
    if (fromItemId === toItemId) throw new Error('fromItemId and toItemId must be different');

    // Validate items
    const [fromItem, toItem] = await Promise.all([getItemLite(fromItemId), getItemLite(toItemId)]);

    // Enforce same productType for repack (packing variants of the same product type)
    if (String(fromItem.productType) !== String(toItem.productType)) {
      throw new Error('Repack requires both items to have the same productType');
    }

    // If a uom was provided, ensure consistency
    if (uom && fromItem.uom && toItem.uom) {
      if (fromItem.uom !== toItem.uom || fromItem.uom !== uom) {
        throw new Error('UOM mismatch between items for repack');
      }
    }

    // 1) OUT from source item
    const outRes = await postMovement({
      companyId,
      itemId: fromItemId,
      warehouseId,
      uom,
      qty: -q,
      txnType: 'REPACK',
      by,
      note,
      refType,
      refId,
      bin,
      batchNo,
      enforceNonNegative,
      session,
    });

    // 2) IN to destination item
    const inRes = await postMovement({
      companyId,
      itemId: toItemId,
      warehouseId,
      uom,
      qty: +q,
      txnType: 'REPACK',
      by,
      note,
      refType,
      refId,
      bin,
      batchNo,
      enforceNonNegative: false,
      session,
    });

    await session.commitTransaction();
    session.endSession();
    return { out: outRes, in: inRes };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * Utility: read snapshot and ledger
 */
// services/inventoryService.js
export async function getSnapshot(filter = {}, itemFilter = {}) {
  const snaps = await InventorySnapshot.find(filter)
    .populate('warehouseId', 'name')
    .populate({
      path: 'itemId',
      select: 'name categoryKey productType density temperature packing dimension grade',
      populate: [
        { path: 'density', select: 'value unit' },
        { path: 'temperature', select: 'value unit' },
        { path: 'packing', select: 'name brandType productColor UOM' },
        { path: 'dimension', select: 'width length thickness unit' },
      ],
    })
    .lean();
    console.log('getSnapshot snaps', snaps);
  // if no item-level filters → return as-is
  if (
    !itemFilter.categoryKey &&
    !itemFilter.productType &&
    !itemFilter.temperature &&
    !itemFilter.density &&
    !itemFilter.dimension &&
    !itemFilter.packing
  ) {
    return snaps;
  }

  // otherwise filter in memory
  return snaps.filter((row) => {
    const item = row.itemId || {};

    if (itemFilter.categoryKey && item.categoryKey !== itemFilter.categoryKey) {
      return false;
    }
    if (itemFilter.productType && String(item.productType) !== String(itemFilter.productType)) {
      return false;
    }
    if (itemFilter.temperature && String(item.temperature?._id) !== String(itemFilter.temperature)) {
      return false;
    }
    if (itemFilter.density && String(item.density?._id) !== String(itemFilter.density)) {
      return false;
    }
    if (itemFilter.dimension && String(item.dimension?._id) !== String(itemFilter.dimension)) {
      return false;
    }
    if (itemFilter.packing && String(item.packing?._id) !== String(itemFilter.packing)) {
      return false;
    }

    return true;
  });
}
export async function getLedger(filter = {}, opts = { limit: 100, sort: { at: -1 } }) {
  return InventoryLedger.find(filter)
    .populate('warehouseId', 'name')
    .populate('by', 'fullName')
    .populate({
      path: 'itemId',
      select: 'name density temperature packing dimension',
      populate: [
        { path: 'density', select: 'value unit' },
        { path: 'temperature', select: 'value unit' },
        { path: 'packing', select: 'name brandType productColor UOM' },
        { path: 'dimension', select: 'width length thickness unit' },
      ],
    })
    .sort(opts.sort || { at: -1 })
    .limit(opts.limit || 100)
    .lean();
}