import mongoose from 'mongoose';
import InventoryLedger from '../models/InventoryLedger.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import InventoryReservationEvent from '../models/InventoryReservationEvent.js';
import Item from '../models/Item.js';
import Warehouse from '../models/Warehouse.js';
import ProductType from '../models/ProductType.js';
import Temperature from '../models/Temperature.js';
import Density from '../models/Density.js';
import Dimension from '../models/Dimension.js';
import { AppError } from '../utils/errorHandler.js';

/**
 * Inventory is ledger-first:
 * - InventoryLedger is the immutable audit trail.
 * - InventorySnapshot is the transactionally maintained read model.
 * - Item.UOM is the only stock UOM for an Item.
 */

const MOVEMENT_TYPES = new Set([
  'RECEIPT',
  'ISSUE',
  'TRANSFER',
  'ADJUST',
  'REPACK',
]);

const fail = (message, statusCode = 400, code = 'INVENTORY_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

const asNumber = (value, label = 'Quantity') => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw fail(`${label} must be a finite number`, 400, 'INVALID_QUANTITY');
  }
  return number;
};

const normalizeOptional = value => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const normalizeUom = value => String(value ?? '').trim().toLowerCase();

const normalizeIdempotencyKey = value => {
  const key = normalizeOptional(value);
  if (key && key.length > 240) {
    throw fail('requestId is too long', 400, 'INVALID_REQUEST_ID');
  }
  return key;
};

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sameValue = (left, right) => String(left ?? '') === String(right ?? '');

const SEARCH_UNIT_STOP_WORDS = new Set([
  'c',
  'kg',
  'g',
  'mm',
  'cm',
  'm',
  'm2',
  'm3',
  'pcs',
  'pc',
]);

function inventorySearchTokens(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3')
    .replace(/(?<=\d)[x×](?=\d)/g, ' ')
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .replace(/([a-z])(\d)/gi, '$1 $2');
  const tokens = [...new Set(normalized.match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [])];
  const meaningful = tokens.length > 1
    ? tokens.filter(token => !SEARCH_UNIT_STOP_WORDS.has(token))
    : tokens;
  return (meaningful.length ? meaningful : tokens).slice(0, 8);
}

function categoryKeysForToken(token) {
  const aliases = {
    fg: ['FG'],
    finished: ['FG'],
    goods: ['FG'],
    raw: ['RAW'],
    material: ['RAW', 'PACKING'],
    packing: ['PACKING'],
    packaging: ['PACKING'],
    nc: ['NC'],
    nonconforming: ['NC'],
    nonconformance: ['NC'],
  };
  return aliases[token] || [];
}

async function specificationIdsForSearchToken(companyId, token) {
  const regex = new RegExp(escapeRegex(token), 'i');
  const number = Number(token);
  const isNumber = Number.isFinite(number) && /^-?\d+(?:\.\d+)?$/.test(token);

  const [productTypeIds, temperatureIds, densityIds, dimensionIds] = await Promise.all([
    ProductType.find({ name: regex }).distinct('_id'),
    Temperature.find(
      isNumber ? { value: number } : { unit: regex },
    ).distinct('_id'),
    Density.find(
      isNumber ? { value: number } : { unit: regex },
    ).distinct('_id'),
    Dimension.find(
      isNumber
        ? {
            $or: [
              { length: number },
              { width: number },
              { thickness: number },
            ],
          }
        : { unit: regex },
    ).distinct('_id'),
  ]);

  const packingOr = [
    { name: regex },
    { sku: regex },
    { grade: regex },
    { description: regex },
    { brandType: regex },
    { productColor: regex },
    { UOM: regex },
  ];
  if (productTypeIds.length) packingOr.push({ productType: { $in: productTypeIds } });
  if (dimensionIds.length) packingOr.push({ dimension: { $in: dimensionIds } });

  const packingIds = await Item.find({
    companyId,
    categoryKey: 'PACKING',
    $or: packingOr,
  }).distinct('_id');

  return {
    regex,
    productTypeIds,
    temperatureIds,
    densityIds,
    dimensionIds,
    packingIds,
    categoryKeys: categoryKeysForToken(token),
  };
}

async function itemSearchClause(companyId, token) {
  const specifications = await specificationIdsForSearchToken(companyId, token);
  const clauses = [
    { name: specifications.regex },
    { sku: specifications.regex },
    { grade: specifications.regex },
    { description: specifications.regex },
    { UOM: specifications.regex },
    { brandType: specifications.regex },
    { productColor: specifications.regex },
  ];
  if (specifications.productTypeIds.length) {
    clauses.push({ productType: { $in: specifications.productTypeIds } });
  }
  if (specifications.temperatureIds.length) {
    clauses.push({ temperature: { $in: specifications.temperatureIds } });
  }
  if (specifications.densityIds.length) {
    clauses.push({ density: { $in: specifications.densityIds } });
  }
  if (specifications.dimensionIds.length) {
    clauses.push({ dimension: { $in: specifications.dimensionIds } });
  }
  if (specifications.packingIds.length) {
    clauses.push({ packing: { $in: specifications.packingIds } });
    clauses.push({ _id: { $in: specifications.packingIds } });
  }
  if (specifications.categoryKeys.length) {
    clauses.push({ categoryKey: { $in: specifications.categoryKeys } });
  }
  return { $or: clauses };
}

async function itemIdsForSearchToken(companyId, token) {
  const clause = await itemSearchClause(companyId, token);
  return Item.find({ companyId, ...clause }).distinct('_id');
}

async function inventorySearchClauses(companyId, search, { ledger = false } = {}) {
  const tokens = inventorySearchTokens(search);
  if (!tokens.length) return [];

  return Promise.all(tokens.map(async token => {
    const regex = new RegExp(escapeRegex(token), 'i');
    const [itemIds, warehouseIds] = await Promise.all([
      itemIdsForSearchToken(companyId, token),
      Warehouse.find({
        companyId,
        $or: [
          { code: regex },
          { name: regex },
          { address: regex },
          { state: regex },
          { pincode: regex },
        ],
      }).distinct('_id'),
    ]);
    const clauses = [
      { batchNo: regex },
      { bin: regex },
      { uom: regex },
    ];
    if (itemIds.length) clauses.push({ itemId: { $in: itemIds } });
    if (warehouseIds.length) clauses.push({ warehouseId: { $in: warehouseIds } });
    if (ledger) {
      clauses.push(
        { refType: regex },
        { refId: regex },
        { note: regex },
      );
    }
    return { $or: clauses };
  }));
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${label} is invalid`, 400, 'INVALID_ID', { field: label });
  }
}

async function getInventoryItem(
  itemId,
  companyId,
  session = null,
  allowInactive = false,
) {
  validateObjectId(itemId, 'itemId');
  validateObjectId(companyId, 'companyId');

  const query = Item.findOne({ _id: itemId, companyId })
    .select('_id companyId name categoryKey productType UOM status')
    .lean();
  if (session) query.session(session);

  const item = await query;
  if (!item) {
    throw fail('Item not found', 404, 'ITEM_NOT_FOUND');
  }
  if (!['FG', 'RAW', 'PACKING', 'NC'].includes(item.categoryKey)) {
    throw fail('Item has an invalid or missing categoryKey', 409, 'INVALID_ITEM_METADATA');
  }
  if (!allowInactive && item.status !== 'active') {
    throw fail(
      `${item.name} must be active before it can be used in inventory`,
      409,
      'ITEM_NOT_ACTIVE',
    );
  }
  if (item.categoryKey === 'FG' && !item.productType) {
    throw fail(
      'Finished-goods Items require a Product Type for inventory',
      409,
      'INVALID_ITEM_METADATA',
    );
  }
  if (!normalizeUom(item.UOM)) {
    throw fail(`${item.name} does not have a valid UOM`, 409, 'INVALID_ITEM_UOM');
  }
  return item;
}

async function ensureWarehouse(
  warehouseId,
  companyId,
  session = null,
  allowInactive = false,
) {
  validateObjectId(warehouseId, 'warehouseId');
  const query = Warehouse.exists({
    _id: warehouseId,
    companyId,
    ...(allowInactive ? {} : { status: 'active' }),
  });
  if (session) query.session(session);
  if (!await query) {
    throw fail('Active Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
  }
}

async function resolveBucket({
  companyId,
  itemId,
  warehouseId,
  requestedUom,
  bin,
  batchNo,
  session,
  allowInactiveItem = false,
  allowInactiveWarehouse = false,
}) {
  // MongoDB does not support parallel operations on the same transaction
  // session. Keep every session-bound operation strictly sequential.
  const item = await getInventoryItem(
    itemId,
    companyId,
    session,
    allowInactiveItem,
  );
  await ensureWarehouse(
    warehouseId,
    companyId,
    session,
    allowInactiveWarehouse,
  );

  const uom = normalizeUom(item.UOM);
  const suppliedUom = normalizeUom(requestedUom);
  if (suppliedUom && suppliedUom !== uom) {
    throw fail(
      `UOM must be ${uom} for ${item.name}`,
      409,
      'ITEM_UOM_MISMATCH',
      { expected: uom, received: suppliedUom },
    );
  }

  return {
    item,
    identity: {
      companyId,
      itemId: item._id,
      categoryKey: item.categoryKey,
      productType: item.productType || null,
      warehouseId,
      uom,
      bin: normalizeOptional(bin),
      batchNo: normalizeOptional(batchNo),
    },
  };
}

async function runInventoryTransaction(work) {
  const session = await mongoose.startSession();
  try {
    // withTransaction retries transient transaction and ambiguous commit errors.
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

function assertIdempotentMovementMatches(existing, expected) {
  const comparableFields = [
    'itemId',
    'warehouseId',
    'uom',
    'bin',
    'batchNo',
    'txnType',
    'eventType',
    'quantity',
  ];
  const mismatched = comparableFields.filter(field =>
    !sameValue(existing[field], expected[field])
  );
  if (mismatched.length) {
    throw fail(
      'This requestId was already used for a different inventory movement',
      409,
      'IDEMPOTENCY_KEY_REUSED',
      { fields: mismatched },
    );
  }
}

async function findIdempotentResult({
  companyId,
  idempotencyKey,
  expected,
  identity,
  session = null,
}) {
  if (!idempotencyKey) return null;
  const ledgerQuery = InventoryLedger.findOne({ companyId, idempotencyKey });
  if (session) ledgerQuery.session(session);
  const ledger = await ledgerQuery;
  if (!ledger) return null;

  assertIdempotentMovementMatches(ledger, expected);
  const snapshotQuery = InventorySnapshot.findOne({
    companyId: identity.companyId,
    itemId: identity.itemId,
    warehouseId: identity.warehouseId,
    uom: identity.uom,
    bin: identity.bin,
    batchNo: identity.batchNo,
  });
  if (session) snapshotQuery.session(session);
  const snapshot = await snapshotQuery;
  return { ledger, snapshot, duplicate: true };
}

/**
 * Post one signed movement. The ledger insert and atomic snapshot increment are
 * committed together. A requestId/idempotencyKey makes safe retries a no-op.
 */
export async function postMovement({
  companyId,
  itemId,
  warehouseId,
  uom,
  qty,
  txnType,
  by,
  note = '',
  refType = null,
  refId = null,
  bin = null,
  batchNo = null,
  at = null,
  requestId = null,
  idempotencyKey = null,
  enforceNonNegative = true,
  allowInactiveItem = false,
  allowInactiveWarehouse = false,
  session: externalSession,
}) {
  const signedQty = asNumber(qty);
  if (signedQty === 0) {
    throw fail('Quantity cannot be zero', 400, 'INVALID_QUANTITY');
  }
  if (!MOVEMENT_TYPES.has(txnType)) {
    throw fail('Invalid transaction type', 400, 'INVALID_TRANSACTION_TYPE');
  }

  const effectiveAt = at ? new Date(at) : new Date();
  if (Number.isNaN(effectiveAt.getTime())) {
    throw fail('Movement date is invalid', 400, 'INVALID_MOVEMENT_DATE');
  }

  const key = normalizeIdempotencyKey(idempotencyKey || requestId);
  let expected;
  let identity;
  const execute = async session => {
    const resolved = await resolveBucket({
      companyId,
      itemId,
      warehouseId,
      requestedUom: uom,
      bin,
      batchNo,
      session,
      allowInactiveItem,
      allowInactiveWarehouse,
    });
    identity = resolved.identity;
    expected = {
      itemId: identity.itemId,
      warehouseId: identity.warehouseId,
      uom: identity.uom,
      bin: identity.bin,
      batchNo: identity.batchNo,
      txnType,
      quantity: signedQty,
    };

    const existingResult = await findIdempotentResult({
      companyId,
      idempotencyKey: key,
      expected,
      identity,
      session,
    });
    if (existingResult) {
      return existingResult;
    }

    const [ledger] = await InventoryLedger.create([{
      ...identity,
      quantity: signedQty,
      txnType,
      refType: normalizeOptional(refType),
      refId: normalizeOptional(refId),
      idempotencyKey: key,
      note: String(note || '').trim().slice(0, 2000),
      by: by || null,
      at: effectiveAt,
    }], { session });

    const snapshot = await InventorySnapshot.incOnHand(
      identity,
      signedQty,
      session,
      { enforceNonNegative },
    );
    if (!snapshot) {
      throw fail(
        'Insufficient available stock for this bucket',
        409,
        'INSUFFICIENT_STOCK',
        {
          itemId: String(identity.itemId),
          warehouseId: String(identity.warehouseId),
          bin: identity.bin,
          batchNo: identity.batchNo,
          uom: identity.uom,
        },
      );
    }

    return { ledger, snapshot, duplicate: false };
  };

  if (externalSession) {
    return execute(externalSession);
  }

  try {
    return await runInventoryTransaction(execute);
  } catch (error) {
    if (key && error?.code === 11000 && expected && identity) {
      const existingResult = await findIdempotentResult({
        companyId,
        idempotencyKey: key,
        expected,
        identity,
      });
      if (existingResult) return existingResult;
    }
    throw error;
  }
}

export async function receive(params) {
  const qty = Math.abs(asNumber(params.qty));
  if (!qty) throw fail('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
  return postMovement({ ...params, qty, txnType: 'RECEIPT' });
}

export async function issue(params) {
  const qty = Math.abs(asNumber(params.qty));
  if (!qty) throw fail('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
  return postMovement({ ...params, qty: -qty, txnType: 'ISSUE' });
}

export async function adjust(params) {
  const qty = asNumber(params.qty);
  if (!qty) throw fail('Quantity cannot be zero', 400, 'INVALID_QUANTITY');
  return postMovement({ ...params, qty, txnType: 'ADJUST' });
}

export async function transfer({
  companyId,
  itemId,
  fromWarehouseId,
  toWarehouseId,
  uom,
  qty,
  by,
  note = '',
  refType = 'TRANSFER',
  refId = null,
  fromBin = null,
  toBin = null,
  bin = null,
  batchNo = null,
  toBatchNo = null,
  requestId = null,
  idempotencyKey = null,
  enforceNonNegative = true,
}) {
  const q = Math.abs(asNumber(qty));
  if (!q) throw fail('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
  validateObjectId(fromWarehouseId, 'fromWarehouseId');
  validateObjectId(toWarehouseId, 'toWarehouseId');

  const sourceBin = normalizeOptional(fromBin ?? bin);
  const destinationBin = normalizeOptional(toBin ?? bin);
  const sourceBatch = normalizeOptional(batchNo);
  const destinationBatch = normalizeOptional(toBatchNo ?? batchNo);
  if (
    sameValue(fromWarehouseId, toWarehouseId) &&
    sameValue(sourceBin, destinationBin) &&
    sameValue(sourceBatch, destinationBatch)
  ) {
    throw fail(
      'Transfer source and destination must be different',
      409,
      'SAME_TRANSFER_BUCKET',
    );
  }

  const baseKey = normalizeIdempotencyKey(idempotencyKey || requestId);
  const movementRef = normalizeOptional(refId) || baseKey || String(new mongoose.Types.ObjectId());
  return runInventoryTransaction(async session => {
    const out = await postMovement({
      companyId,
      itemId,
      warehouseId: fromWarehouseId,
      uom,
      qty: -q,
      txnType: 'TRANSFER',
      by,
      note,
      refType,
      refId: movementRef,
      bin: sourceBin,
      batchNo: sourceBatch,
      idempotencyKey: baseKey ? `${baseKey}:OUT` : null,
      enforceNonNegative,
      session,
    });
    const inbound = await postMovement({
      companyId,
      itemId,
      warehouseId: toWarehouseId,
      uom,
      qty: q,
      txnType: 'TRANSFER',
      by,
      note,
      refType,
      refId: movementRef,
      bin: destinationBin,
      batchNo: destinationBatch,
      idempotencyKey: baseKey ? `${baseKey}:IN` : null,
      enforceNonNegative: false,
      session,
    });

    return { out, in: inbound };
  });
}

async function postReservationEvent({
  companyId,
  itemId,
  warehouseId,
  uom,
  qty,
  eventType,
  by = null,
  note = '',
  refType = null,
  refId = null,
  requestId = null,
  idempotencyKey = null,
  bin = null,
  batchNo = null,
  session: externalSession,
}) {
  const absoluteQty = Math.abs(asNumber(qty));
  if (!absoluteQty) {
    throw fail('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
  }
  const signedQty = eventType === 'RELEASE' ? -absoluteQty : absoluteQty;
  const key = normalizeIdempotencyKey(idempotencyKey || requestId);

  let identity;
  const expected = {
    itemId,
    warehouseId,
    bin: normalizeOptional(bin),
    batchNo: normalizeOptional(batchNo),
    eventType,
    quantity: signedQty,
  };
  const execute = async session => {
    ({ identity } = await resolveBucket({
      companyId,
      itemId,
      warehouseId,
      requestedUom: uom,
      bin,
      batchNo,
      session,
      allowInactiveItem: eventType === 'RELEASE',
      allowInactiveWarehouse: eventType === 'RELEASE',
    }));

    if (key) {
      const existing = await InventoryReservationEvent.findOne({
        companyId,
        idempotencyKey: key,
      }).session(session);
      if (existing) {
        assertIdempotentMovementMatches(existing, {
          ...expected,
          uom: identity.uom,
        });
        const snapshot = await InventorySnapshot.findOne({
          companyId,
          itemId: identity.itemId,
          warehouseId: identity.warehouseId,
          uom: identity.uom,
          bin: identity.bin,
          batchNo: identity.batchNo,
        }).session(session);
        return { event: existing, snapshot, duplicate: true };
      }
    }

    const [event] = await InventoryReservationEvent.create([{
      ...identity,
      quantity: signedQty,
      eventType,
      idempotencyKey: key,
      refType: normalizeOptional(refType),
      refId: normalizeOptional(refId),
      note: String(note || '').trim().slice(0, 2000),
      by,
    }], { session });
    const snapshot = await InventorySnapshot.incReserved(identity, signedQty, session);
    if (!snapshot) {
      throw fail(
        eventType === 'RELEASE'
          ? 'Release quantity exceeds the reserved quantity'
          : 'Insufficient available stock to reserve',
        409,
        eventType === 'RELEASE'
          ? 'INSUFFICIENT_RESERVED_STOCK'
          : 'INSUFFICIENT_STOCK',
      );
    }
    return { event, snapshot, duplicate: false };
  };

  if (externalSession) {
    return execute(externalSession);
  }

  try {
    return await runInventoryTransaction(execute);
  } catch (error) {
    if (key && error?.code === 11000 && identity) {
      const existing = await InventoryReservationEvent.findOne({
        companyId,
        idempotencyKey: key,
      });
      if (existing) {
        assertIdempotentMovementMatches(existing, {
          ...expected,
          uom: identity.uom,
        });
        const snapshot = await InventorySnapshot.findOne({
          companyId,
          itemId: identity.itemId,
          warehouseId: identity.warehouseId,
          uom: identity.uom,
          bin: identity.bin,
          batchNo: identity.batchNo,
        });
        return { event: existing, snapshot, duplicate: true };
      }
    }
    throw error;
  }
}

export function reserveStock(params) {
  return postReservationEvent({ ...params, eventType: 'RESERVE' });
}

export function releaseReservation(params) {
  return postReservationEvent({ ...params, eventType: 'RELEASE' });
}

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
  requestId = null,
  idempotencyKey = null,
  enforceNonNegative = true,
}) {
  const q = Math.abs(asNumber(qty));
  if (!q) throw fail('Quantity must be greater than zero', 400, 'INVALID_QUANTITY');
  if (sameValue(fromItemId, toItemId)) {
    throw fail('From and To Items must be different', 409, 'SAME_REPACK_ITEM');
  }

  return runInventoryTransaction(async session => {
    const fromItem = await getInventoryItem(fromItemId, companyId, session);
    const toItem = await getInventoryItem(toItemId, companyId, session);
    await ensureWarehouse(warehouseId, companyId, session);

    if (fromItem.categoryKey !== 'FG' || toItem.categoryKey !== 'FG') {
      throw fail('Repacking requires two finished-goods Items', 409, 'INVALID_REPACK_ITEMS');
    }
    if (!sameValue(fromItem.productType, toItem.productType)) {
      throw fail(
        'Repacking requires both Items to have the same Product Type',
        409,
        'INVALID_REPACK_ITEMS',
      );
    }
    if (normalizeUom(fromItem.UOM) !== normalizeUom(toItem.UOM)) {
      throw fail('Repacking requires matching Item UOMs', 409, 'ITEM_UOM_MISMATCH');
    }
    const requestedUom = normalizeUom(uom);
    if (requestedUom && requestedUom !== normalizeUom(fromItem.UOM)) {
      throw fail(
        `UOM must be ${normalizeUom(fromItem.UOM)} for this repacking`,
        409,
        'ITEM_UOM_MISMATCH',
      );
    }

    const baseKey = normalizeIdempotencyKey(idempotencyKey || requestId);
    const movementRef = normalizeOptional(refId) || baseKey || String(new mongoose.Types.ObjectId());
    const out = await postMovement({
      companyId,
      itemId: fromItemId,
      warehouseId,
      uom: fromItem.UOM,
      qty: -q,
      txnType: 'REPACK',
      by,
      note,
      refType,
      refId: movementRef,
      bin,
      batchNo,
      idempotencyKey: baseKey ? `${baseKey}:OUT` : null,
      enforceNonNegative,
      session,
    });
    const inbound = await postMovement({
      companyId,
      itemId: toItemId,
      warehouseId,
      uom: toItem.UOM,
      qty: q,
      txnType: 'REPACK',
      by,
      note,
      refType,
      refId: movementRef,
      bin,
      batchNo,
      idempotencyKey: baseKey ? `${baseKey}:IN` : null,
      enforceNonNegative: false,
      session,
    });

    return { out, in: inbound };
  });
}

async function itemIdsForFilter(companyId, itemFilter = {}) {
  const {
    categoryKey,
    productType,
    temperature,
    density,
    dimension,
    packing,
    itemStatus,
    search,
  } = itemFilter;
  const hasFilter = [
    categoryKey,
    productType,
    temperature,
    density,
    dimension,
    packing,
    itemStatus,
    search,
  ].some(Boolean);
  if (!hasFilter) return null;

  const filter = { companyId };
  if (categoryKey) filter.categoryKey = String(categoryKey).toUpperCase();
  if (productType) filter.productType = productType;
  if (temperature) filter.temperature = temperature;
  if (density) filter.density = density;
  if (dimension) filter.dimension = dimension;
  if (packing) filter.packing = packing;
  if (itemStatus) filter.status = itemStatus;
  if (search) {
    const tokens = inventorySearchTokens(search);
    if (tokens.length) {
      filter.$and = await Promise.all(
        tokens.map(token => itemSearchClause(companyId, token)),
      );
    }
  }

  return Item.find(filter).distinct('_id');
}

const INVENTORY_ITEM_POPULATE = {
  path: 'itemId',
  select: (
    'name sku status categoryKey productType UOM minimumStock density '
    + 'temperature packing dimension grade'
  ),
  populate: [
    { path: 'productType', select: 'name' },
    { path: 'density', select: 'value unit' },
    { path: 'temperature', select: 'value unit' },
    { path: 'packing', select: 'name brandType productColor UOM' },
    { path: 'dimension', select: 'width length thickness unit' },
  ],
};

export async function getSnapshot(
  filter = {},
  itemFilter = {},
  { limit = 300, cursor = null, includeZero = false, positiveOnly = false, reservedOnly = false } = {},
) {
  if (!filter.companyId) throw fail('companyId is required', 401, 'COMPANY_REQUIRED');
  const queryFilter = { ...filter };
  const { search = '', ...baseItemFilter } = itemFilter;
  const itemIds = await itemIdsForFilter(filter.companyId, baseItemFilter);
  if (itemIds) {
    if (!itemIds.length) return { rows: [], nextCursor: null };
    queryFilter.itemId = queryFilter.itemId
      ? { $in: itemIds.filter(id => sameValue(id, queryFilter.itemId)) }
      : { $in: itemIds };
  }
  const searchClauses = await inventorySearchClauses(filter.companyId, search);
  if (searchClauses.length) {
    queryFilter.$and = [...(queryFilter.$and || []), ...searchClauses];
  }
  if (positiveOnly) queryFilter.available = { $gt: 0 };
  else if (reservedOnly) queryFilter.reserved = { $gt: 0 };
  else if (!includeZero) {
    queryFilter.$or = [{ onHand: { $ne: 0 } }, { reserved: { $ne: 0 } }];
  }
  if (cursor) {
    validateObjectId(cursor, 'cursor');
    queryFilter._id = { ...(queryFilter._id || {}), $lt: cursor };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const rowsPlusOne = await InventorySnapshot.find(queryFilter)
    .populate('warehouseId', 'name code')
    .populate(INVENTORY_ITEM_POPULATE)
    .sort({ _id: -1 })
    .limit(safeLimit + 1)
    .lean();
  const hasMore = rowsPlusOne.length > safeLimit;
  const rows = hasMore ? rowsPlusOne.slice(0, safeLimit) : rowsPlusOne;
  return {
    rows,
    nextCursor: hasMore && rows.length ? String(rows[rows.length - 1]._id) : null,
  };
}

export async function getLedger(
  filter = {},
  {
    limit = 100,
    cursor = null,
    itemFilter = {},
    search = '',
    from = null,
    to = null,
  } = {},
) {
  if (!filter.companyId) throw fail('companyId is required', 401, 'COMPANY_REQUIRED');
  const queryFilter = { ...filter };
  const itemIds = await itemIdsForFilter(filter.companyId, itemFilter);
  if (itemIds) {
    if (!itemIds.length) return { rows: [], nextCursor: null };
    if (itemIds.length) {
      if (queryFilter.itemId) {
        const matchesRequestedItem = itemIds.some(id =>
          sameValue(id, queryFilter.itemId)
        );
        if (!matchesRequestedItem) return { rows: [], nextCursor: null };
      } else {
        queryFilter.itemId = { $in: itemIds };
      }
    }
  }

  const searchClauses = await inventorySearchClauses(
    filter.companyId,
    search,
    { ledger: true },
  );
  if (searchClauses.length) {
    queryFilter.$and = [...(queryFilter.$and || []), ...searchClauses];
  }

  const dateFilter = {};
  if (from) dateFilter.$gte = from;
  if (to) dateFilter.$lte = to;
  if (Object.keys(dateFilter).length) queryFilter.at = dateFilter;
  if (cursor?.at && cursor?._id) {
    queryFilter.$and = [
      ...(queryFilter.$and || []),
      {
        $or: [
          { at: { $lt: cursor.at } },
          { at: cursor.at, _id: { $lt: cursor._id } },
        ],
      },
    ];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rowsPlusOne = await InventoryLedger.find(queryFilter)
    .populate('warehouseId', 'name code')
    .populate('by', 'fullName')
    .populate(INVENTORY_ITEM_POPULATE)
    .sort({ at: -1, _id: -1 })
    .limit(safeLimit + 1)
    .lean();
  const hasMore = rowsPlusOne.length > safeLimit;
  const rows = hasMore ? rowsPlusOne.slice(0, safeLimit) : rowsPlusOne;
  const last = hasMore ? rows[rows.length - 1] : null;
  return {
    rows,
    nextCursor: last
      ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), _id: String(last._id) }))
        .toString('base64url')
      : null,
  };
}
