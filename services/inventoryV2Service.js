import crypto from 'crypto';
import mongoose from 'mongoose';
import InventoryBalanceV2 from '../models/InventoryBalanceV2.js';
import InventoryCostBalance from '../models/InventoryCostBalance.js';
import InventoryLotV2 from '../models/InventoryLotV2.js';
import InventorySerialV2 from '../models/InventorySerialV2.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import ManufacturingRecipeV2 from '../models/ManufacturingRecipeV2.js';
import Warehouse from '../models/Warehouse.js';
import Campaign from '../models/Campaign.js';
import Company from '../models/Company.js';
import { AppError } from '../utils/errorHandler.js';
import {
  generateInventorySerialBatch,
  isValidInventorySerial,
} from '../utils/serialNumber.js';

const EPSILON = 1e-9;
const roundQuantity = value => Number(Number(value).toFixed(6));
const roundMoney = value => Number(Number(value).toFixed(4));
const fail = (message, statusCode = 400, code = 'INVENTORY_V2_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });
const normalizeOptional = value => String(value ?? '').trim() || null;
const normalizeCode = value => String(value ?? '').trim().toUpperCase();
const serialTracked = item => Boolean(item?.trackingPolicy?.serialTracked);

export const shouldCreateTraceSerials = (item, sourceType, skipSerials = false) =>
  serialTracked(item)
  && !skipSerials
  && ['MANUAL_RECEIPT', 'PROD_GATEWAY'].includes(normalizeCode(sourceType));

export function validateManualSerializedUnits(quantity, units, baseUom = 'unit') {
  if (!Number.isInteger(quantity) || !Array.isArray(units) || units.length !== quantity) {
    throw fail(
      `Manual serialized receipts require exactly ${quantity} individual ${baseUom} weight rows`,
      400,
      'SERIAL_QUANTITY_MISMATCH',
      { expected: quantity, received: Array.isArray(units) ? units.length : 0 },
    );
  }
  return true;
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw fail(`${field} must be greater than zero`, 400, 'INVALID_INVENTORY_QUANTITY', {
      field,
    });
  }
  return roundQuantity(number);
}

function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw fail(`${field} cannot be negative`, 400, 'INVALID_INVENTORY_VALUE', { field });
  }
  return roundMoney(number);
}

function enforceWholeUnit(item, quantity, field = 'quantity') {
  if (['roll', 'nos'].includes(item.baseUom) && !Number.isInteger(quantity)) {
    throw fail(
      `${field} must be a whole number for UOM ${item.baseUom}`,
      400,
      'WHOLE_UNIT_QUANTITY_REQUIRED',
      { field, uom: item.baseUom },
    );
  }
}

function objectId(value, field) {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${field} is invalid`, 400, 'INVALID_ID', { field });
  }
}

function transactionNo(type) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${type.slice(0, 3)}-${date}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function generatedLotNo(item) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${item.sku}-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function loadContext(companyId, itemId, warehouseId, session) {
  objectId(companyId, 'companyId');
  objectId(itemId, 'itemId');
  objectId(warehouseId, 'warehouseId');
  const item = await ItemMaster.findOne({
    _id: itemId,
    companyId,
    status: 'active',
    'capabilities.inventory': true,
  }).session(session).lean();
  if (!item) {
    throw fail(
      'Active inventory-enabled Item Master was not found',
      404,
      'INVENTORY_ITEM_NOT_FOUND',
    );
  }
  const warehouse = await Warehouse.findOne({
    _id: warehouseId,
    companyId,
    status: 'active',
  }).session(session).select('_id').lean();
  if (!warehouse) throw fail('Active Warehouse was not found', 404, 'WAREHOUSE_NOT_FOUND');
  return item;
}

async function findExisting(companyId, idempotencyKey, session = null) {
  if (!idempotencyKey) {
    throw fail('idempotencyKey is required', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  if (String(idempotencyKey).length > 240) {
    throw fail('idempotencyKey is too long', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const query = InventoryTransactionV2.findOne({ companyId, idempotencyKey });
  if (session) query.session(session);
  return query.lean();
}

async function runTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      output = await work(session);
    });
    return output;
  } finally {
    await session.endSession();
  }
}

async function applyBalance({
  companyId,
  item,
  warehouseId,
  bin,
  lot,
  qualityStatus,
  processStatus,
  quantityDelta,
  catchDelta,
  session,
}) {
  const filter = {
    companyId,
    itemId: item._id,
    warehouseId,
    bin,
    lotId: lot._id,
    qualityStatus,
    processStatus,
  };
  const availableMovement = qualityStatus === 'AVAILABLE'
    && ['AVAILABLE', 'PACKED'].includes(processStatus);
  if (quantityDelta < 0) {
    filter.onHand = { $gte: Math.abs(quantityDelta) };
    if (availableMovement) filter.available = { $gte: Math.abs(quantityDelta) };
  }
  const update = {
    $inc: {
      onHand: quantityDelta,
      available: availableMovement ? quantityDelta : 0,
      ...(catchDelta === null ? {} : { catchOnHand: catchDelta }),
    },
    $setOnInsert: {
      companyId,
      itemId: item._id,
      warehouseId,
      bin,
      lotId: lot._id,
      qualityStatus,
      processStatus,
      baseUom: item.baseUom,
      catchUom: item.catchUom || null,
      reserved: 0,
    },
  };
  const balance = await InventoryBalanceV2.findOneAndUpdate(
    filter,
    update,
    {
      new: true,
      upsert: quantityDelta > 0,
      runValidators: true,
      session,
    },
  );
  if (!balance) throw fail('Insufficient available stock', 409, 'INSUFFICIENT_STOCK');
  return balance;
}

async function addAccountingValue(companyId, itemId, quantity, value, session) {
  let balance = await InventoryCostBalance.findOne({ companyId, itemId }).session(session);
  if (!balance) {
    balance = new InventoryCostBalance({
      companyId,
      itemId,
      quantity: 0,
      inventoryValue: 0,
      movingAverageCost: 0,
    });
  }
  balance.quantity = roundQuantity(balance.quantity + quantity);
  balance.inventoryValue = roundMoney(balance.inventoryValue + value);
  if (balance.quantity < -EPSILON || balance.inventoryValue < -0.01) {
    throw fail('Inventory valuation would become negative', 409, 'NEGATIVE_INVENTORY_VALUE');
  }
  if (balance.quantity <= EPSILON) {
    balance.quantity = 0;
    balance.inventoryValue = 0;
    balance.movingAverageCost = 0;
  } else {
    balance.movingAverageCost = roundMoney(balance.inventoryValue / balance.quantity);
  }
  await balance.save({ session });
  return balance;
}

async function currentAverageCost(companyId, itemId, quantity, session) {
  const balance = await InventoryCostBalance.findOne({ companyId, itemId }).session(session).lean();
  if (!balance || balance.quantity + EPSILON < quantity) {
    throw fail('Accounting stock is insufficient for this issue', 409, 'INSUFFICIENT_COST_BALANCE');
  }
  return Number(balance.movingAverageCost || 0);
}

function receiptCatchQuantity(item, input, quantity) {
  if (item.catchMode === 'NONE') return null;
  if (input.catchQuantity !== null && input.catchQuantity !== undefined && input.catchQuantity !== '') {
    return positive(input.catchQuantity, 'catchQuantity');
  }
  if (item.catchMode === 'NOMINAL') {
    return roundQuantity(quantity * Number(item.nominalFactor || 0));
  }
  if (item.catchMode === 'MEASURED') {
    if (input.allowMissingCatchQuantity === true) return null;
    throw fail(
      `Measured ${item.catchUom} is required for ${item.name}`,
      400,
      'MEASURED_CATCH_QUANTITY_REQUIRED',
    );
  }
  return null;
}

const humanizeAttribute = value => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());

function validDateOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fail(`${field} is invalid`, 400, 'INVALID_INVENTORY_DATE', { field });
  }
  return date;
}

async function traceContext(companyId, item, input, lotNo, session) {
  const company = await Company.findById(companyId).session(session).select('companyName').lean();
  if (!company) throw fail('Company was not found', 409, 'COMPANY_NOT_FOUND');
  let campaign = null;
  if (input.campaignId) {
    objectId(input.campaignId, 'campaignId');
    campaign = await Campaign.findOne({ _id: input.campaignId, companyId })
      .session(session)
      .select('_id name')
      .lean();
    if (!campaign) throw fail('Campaign was not found for this company', 404, 'CAMPAIGN_NOT_FOUND');
  }
  return {
    campaign,
    snapshot: {
      manufacturerName: normalizeOptional(input.manufacturerName) || company.companyName,
      productName: item.name,
      sku: item.sku,
      campaignName: campaign?.name || null,
      lotNo,
      specifications: (item.attributes || []).map(attribute => ({
        code: attribute.code,
        label: humanizeAttribute(attribute.code),
        value: attribute.displayValue || attribute.normalizedValue,
        unit: attribute.unit || null,
      })),
    },
  };
}

async function uniqueSerialBatch(count, session) {
  const output = new Set();
  while (output.size < count) {
    const candidates = generateInventorySerialBatch(count - output.size);
    const existing = new Set((await InventorySerialV2.find({
      serialNo: { $in: candidates },
    }).session(session).distinct('serialNo')));
    candidates.filter(serialNo => !existing.has(serialNo)).forEach(serialNo => output.add(serialNo));
  }
  return [...output];
}

async function receiptLine(
  companyId,
  input,
  session,
  { updateAccounting = true, skipSerials = false } = {},
) {
  const item = await loadContext(companyId, input.itemId, input.warehouseId, session);
  const quantity = positive(input.quantity, 'quantity');
  enforceWholeUnit(item, quantity);
  const unitCost = nonNegative(input.unitCost ?? 0, 'unitCost');
  const value = roundMoney(quantity * unitCost);
  const bin = normalizeOptional(input.bin);
  const lotNo = normalizeCode(input.lotNo) || generatedLotNo(item);
  const qualityStatus = normalizeCode(input.qualityStatus) || 'AVAILABLE';
  if (!['AVAILABLE', 'HOLD', 'REJECTED'].includes(qualityStatus)) {
    throw fail('qualityStatus is invalid', 400, 'INVALID_QUALITY_STATUS');
  }
  const processStatus = normalizeCode(input.processStatus) || 'AVAILABLE';
  const sourceType = normalizeCode(input.sourceType);
  if (![
    'AVAILABLE',
    'DRAWN',
    'DRYING',
    'DRIED_AWAITING_QC',
    'EDGED',
    'PACKED',
    'REJECTED',
  ].includes(processStatus)) {
    throw fail('processStatus is invalid', 400, 'INVALID_PROCESS_STATUS');
  }
  const suppliedUnits = Array.isArray(input.units)
    ? input.units
    : (Array.isArray(input.serials) ? input.serials : []);
  // Serials are immutable manufacturing trace records. Create them only at a
  // production/manual manufacturing receipt, never for transfers, packing,
  // repacking, sales, issues, or other technical inventory transactions.
  const managesSerials = shouldCreateTraceSerials(item, sourceType, skipSerials);
  let serialUnits = suppliedUnits;
  if (managesSerials) {
    if (!Number.isInteger(quantity) || quantity > 1000) {
      throw fail(
        'Serialized receipt quantity must be a whole number between 1 and 1000',
        400,
        'INVALID_SERIAL_QUANTITY',
      );
    }
    if (sourceType === 'MANUAL_RECEIPT' && item.catchMode === 'MEASURED') {
      validateManualSerializedUnits(quantity, suppliedUnits, item.baseUom);
    }
    if (!serialUnits.length) serialUnits = Array.from({ length: quantity }, () => ({}));
    if (serialUnits.length !== quantity) {
      throw fail(
        `Serialized receipts require one unit row for each ${item.baseUom}`,
        400,
        'SERIAL_QUANTITY_MISMATCH',
      );
    }
    if (item.catchMode === 'NOMINAL') {
      serialUnits = serialUnits.map(unit => ({
        ...unit,
        catchQuantity: unit.catchQuantity ?? Number(item.nominalFactor || 0),
        catchSource: unit.catchSource || 'NOMINAL',
      }));
    }
    const missingMeasured = serialUnits.some(unit => !(Number(unit.catchQuantity) > 0));
    if (item.catchMode === 'MEASURED' && missingMeasured && qualityStatus === 'AVAILABLE') {
      throw fail(
        `Every serialized ${item.baseUom} requires its own measured ${item.catchUom}`,
        400,
        'SERIAL_WEIGHT_REQUIRED',
      );
    }
  }
  const allUnitWeightsPresent = managesSerials
    && serialUnits.every(unit => Number(unit.catchQuantity) > 0);
  const unitCatchTotal = allUnitWeightsPresent
    ? roundQuantity(serialUnits.reduce(
      (total, unit) => total + Number(unit.catchQuantity),
      0,
    ))
    : null;
  if (
    unitCatchTotal !== null
    && input.catchQuantity !== null
    && input.catchQuantity !== undefined
    && input.catchQuantity !== ''
    && Math.abs(Number(input.catchQuantity) - unitCatchTotal) > 0.001
  ) {
    throw fail(
      'The receipt weight must equal the sum of the individual serial weights',
      400,
      'SERIAL_CATCH_QUANTITY_MISMATCH',
    );
  }
  const catchQuantity = receiptCatchQuantity(item, {
    ...input,
    catchQuantity: unitCatchTotal ?? input.catchQuantity,
  }, quantity);
  const manualReason = normalizeOptional(input.manualReason);
  if (
    managesSerials
    && ['MANUAL_RECEIPT', 'PROD_GATEWAY'].includes(sourceType)
    && serialUnits.some(unit => !validDateOrNull(
      unit.manufacturedAt ?? input.manufacturedAt,
      'manufacturedAt',
    ))
  ) {
    throw fail(
      'Manufacture date and time is required for every serialized unit',
      400,
      'SERIAL_MANUFACTURED_AT_REQUIRED',
    );
  }
  if (managesSerials && sourceType === 'MANUAL_RECEIPT' && !manualReason) {
    throw fail(
      'A reason is required for a manual serialized receipt',
      400,
      'MANUAL_SERIAL_REASON_REQUIRED',
    );
  }
  if (
    managesSerials
    && (
      sourceType === 'PROD_GATEWAY'
      || ['PRODUCTION', 'GATEWAY_FALLBACK'].includes(normalizeCode(input.receiptMode))
    )
    && !input.campaignId
  ) {
    throw fail('Campaign is required for production receipts', 400, 'CAMPAIGN_REQUIRED');
  }

  let lot = await InventoryLotV2.findOne({
    companyId,
    itemId: item._id,
    warehouseId: input.warehouseId,
    lotNo,
  }).session(session);
  if (lot && (
    lot.qualityStatus !== qualityStatus
    || lot.processStatus !== processStatus
    || normalizeOptional(lot.bin) !== bin
    || Math.abs(lot.unitCost - unitCost) > 0.0001
    || (lot.campaignId && input.campaignId
      && String(lot.campaignId) !== String(input.campaignId))
  )) {
    throw fail(
      'An existing lot cannot be reused with different location, quality or cost',
      409,
      'LOT_IDENTITY_CONFLICT',
    );
  }
  if (!lot) {
    [lot] = await InventoryLotV2.create([{
      companyId,
      itemId: item._id,
      campaignId: input.campaignId || null,
      warehouseId: input.warehouseId,
      bin,
      lotNo,
      qualityStatus,
      processStatus,
      receivedAt: input.receivedAt || new Date(),
      manufacturedAt: input.manufacturedAt || null,
      expiresAt: input.expiresAt || null,
      supplierPartyId: input.supplierPartyId || null,
      supplierLotNo: normalizeOptional(input.supplierLotNo),
      originalQuantity: quantity,
      onHandQuantity: quantity,
      originalCatchQuantity: catchQuantity,
      onHandCatchQuantity: catchQuantity,
      baseUom: item.baseUom,
      catchUom: item.catchUom || null,
      unitCost,
      remainingValue: value,
      sourceType,
      sourceId: normalizeOptional(input.sourceId),
      parentLotIds: input.parentLotIds || [],
    }], { session });
  } else {
    if (!lot.campaignId && input.campaignId) lot.campaignId = input.campaignId;
    lot.status = 'OPEN';
    lot.originalQuantity = roundQuantity(lot.originalQuantity + quantity);
    lot.onHandQuantity = roundQuantity(lot.onHandQuantity + quantity);
    lot.remainingValue = roundMoney(lot.remainingValue + value);
    if (catchQuantity !== null) {
      lot.originalCatchQuantity = roundQuantity((lot.originalCatchQuantity || 0) + catchQuantity);
      lot.onHandCatchQuantity = roundQuantity((lot.onHandCatchQuantity || 0) + catchQuantity);
    }
    await lot.save({ session });
  }

  await applyBalance({
    companyId,
    item,
    warehouseId: input.warehouseId,
    bin,
    lot,
    qualityStatus,
    processStatus,
    quantityDelta: quantity,
    catchDelta: catchQuantity,
    session,
  });
  if (updateAccounting) {
    await addAccountingValue(companyId, item._id, quantity, value, session);
  }

  let createdSerials = [];
  if (managesSerials) {
    const trace = await traceContext(companyId, item, input, lot.lotNo, session);
    const generatedSerials = await uniqueSerialBatch(quantity, session);
    createdSerials = await InventorySerialV2.insertMany(serialUnits.map((unit, index) => ({
      companyId,
      itemId: item._id,
      lotId: lot._id,
      campaignId: trace.campaign?._id || null,
      serialNo: generatedSerials[index],
      warehouseId: input.warehouseId,
      bin,
      qualityStatus: qualityStatus === 'AVAILABLE' ? 'ACCEPTED' : qualityStatus,
      baseQuantity: 1,
      catchQuantity: unit.catchQuantity ?? null,
      catchUom: item.catchUom || null,
      catchSource: unit.catchSource || (item.catchMode === 'NOMINAL' ? 'NOMINAL' : 'MANUAL'),
      manufacturedAt: validDateOrNull(unit.manufacturedAt ?? input.manufacturedAt, 'manufacturedAt'),
      measuredAt: validDateOrNull(unit.measuredAt, 'measuredAt')
        || (unit.catchQuantity ? new Date() : null),
      manualReason,
      traceSnapshot: trace.snapshot,
      parentSerialId: unit.parentSerialId || null,
      sourceType,
      sourceId: normalizeOptional(input.sourceId),
    })), { session, ordered: true });
  }

  return {
    direction: 'IN',
    itemId: item._id,
    warehouseId: input.warehouseId,
    bin,
    qualityStatus,
    processStatus,
    quantity,
    catchQuantity,
    baseUom: item.baseUom,
    catchUom: item.catchUom || null,
    unitCost,
    value,
    lotId: lot._id,
    lotNo: lot.lotNo,
    allocations: [],
    serialIds: createdSerials.map(serial => serial._id),
  };
}

async function allocateIssueLots(companyId, item, input, quantity, session) {
  const filter = {
    companyId,
    itemId: item._id,
    warehouseId: input.warehouseId,
    qualityStatus: normalizeCode(input.qualityStatus) || 'AVAILABLE',
    processStatus: input.processStatus
      ? normalizeCode(input.processStatus)
      : { $in: ['AVAILABLE', 'PACKED'] },
    status: 'OPEN',
    onHandQuantity: { $gt: 0 },
    ...(input.bin !== undefined ? { bin: normalizeOptional(input.bin) } : {}),
    ...(input.lotNo ? { lotNo: normalizeCode(input.lotNo) } : {}),
  };
  if (Object.prototype.hasOwnProperty.call(input, 'packingKey')) {
    filter.packingKey = normalizeCode(input.packingKey) === 'UNPACKED'
      ? null
      : normalizeCode(input.packingKey);
  }
  const lots = await InventoryLotV2.find(filter)
    .sort({ receivedAt: 1, _id: 1 })
    .session(session);
  let remaining = quantity;
  const allocations = [];
  for (const lot of lots) {
    if (remaining <= EPSILON) break;
    const allocated = roundQuantity(Math.min(lot.onHandQuantity, remaining));
    const ratio = lot.onHandQuantity > 0 ? allocated / lot.onHandQuantity : 0;
    const catchQuantity = lot.onHandCatchQuantity === null
      ? null
      : roundQuantity(lot.onHandCatchQuantity * ratio);
    const physicalValue = roundMoney(lot.remainingValue * ratio);
    const updated = await InventoryLotV2.findOneAndUpdate(
      { _id: lot._id, onHandQuantity: { $gte: allocated } },
      {
        $inc: {
          onHandQuantity: -allocated,
          remainingValue: -physicalValue,
          ...(catchQuantity === null ? {} : { onHandCatchQuantity: -catchQuantity }),
        },
      },
      { new: true, session, runValidators: true },
    );
    if (!updated) throw fail('Stock changed while allocating FIFO lots', 409, 'STOCK_CONFLICT');
    if (updated.onHandQuantity <= EPSILON) {
      updated.onHandQuantity = 0;
      updated.remainingValue = 0;
      if (updated.onHandCatchQuantity !== null) updated.onHandCatchQuantity = 0;
      updated.status = 'CLOSED';
      await updated.save({ session });
    }
    await applyBalance({
      companyId,
      item,
      warehouseId: input.warehouseId,
      bin: lot.bin,
      lot,
      qualityStatus: lot.qualityStatus,
      processStatus: lot.processStatus,
      quantityDelta: -allocated,
      catchDelta: catchQuantity === null ? null : -catchQuantity,
      session,
    });
    allocations.push({
      lotId: lot._id,
      lotNo: lot.lotNo,
      qualityStatus: lot.qualityStatus,
      processStatus: lot.processStatus,
      quantity: allocated,
      catchQuantity,
      unitCost: lot.unitCost,
      value: physicalValue,
    });
    remaining = roundQuantity(remaining - allocated);
  }
  if (remaining > EPSILON) {
    throw fail('Insufficient FIFO lot stock', 409, 'INSUFFICIENT_STOCK', {
      requested: quantity,
      shortage: remaining,
    });
  }
  return allocations;
}

async function issueLine(
  companyId,
  input,
  session,
  { updateAccounting = true } = {},
) {
  const item = await loadContext(companyId, input.itemId, input.warehouseId, session);
  const quantity = positive(input.quantity, 'quantity');
  enforceWholeUnit(item, quantity);
  const accountingUnitCost = await currentAverageCost(companyId, item._id, quantity, session);
  const value = roundMoney(quantity * accountingUnitCost);
  const allocations = await allocateIssueLots(companyId, item, input, quantity, session);
  const catchQuantity = allocations.some(allocation => allocation.catchQuantity !== null)
    ? roundQuantity(allocations.reduce(
      (total, allocation) => total + Number(allocation.catchQuantity || 0),
      0,
    ))
    : null;
  if (updateAccounting) {
    await addAccountingValue(companyId, item._id, -quantity, -value, session);
  }
  const allocatedProcesses = [...new Set(allocations.map(row => row.processStatus))];
  return {
    direction: 'OUT',
    itemId: item._id,
    warehouseId: input.warehouseId,
    bin: normalizeOptional(input.bin),
    qualityStatus: normalizeCode(input.qualityStatus) || 'AVAILABLE',
    processStatus: input.processStatus
      ? normalizeCode(input.processStatus)
      : (allocatedProcesses.length === 1 ? allocatedProcesses[0] : 'MIXED'),
    quantity,
    catchQuantity,
    baseUom: item.baseUom,
    catchUom: item.catchUom || null,
    unitCost: accountingUnitCost,
    value,
    lotId: allocations.length === 1 ? allocations[0].lotId : null,
    lotNo: allocations.length === 1 ? allocations[0].lotNo : null,
    allocations,
  };
}

async function createPostedTransaction(companyId, actorId, input, entries, session) {
  const totalValueIn = roundMoney(entries
    .filter(entry => entry.direction === 'IN')
    .reduce((total, entry) => total + entry.value, 0));
  const totalValueOut = roundMoney(entries
    .filter(entry => entry.direction === 'OUT')
    .reduce((total, entry) => total + entry.value, 0));
  const [transaction] = await InventoryTransactionV2.create([{
    companyId,
    transactionNo: transactionNo(input.type),
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    effectiveAt: input.effectiveAt || new Date(),
    referenceType: normalizeCode(input.referenceType),
    referenceId: normalizeOptional(input.referenceId),
    reason: normalizeOptional(input.reason || input.manualReason),
    authorizationReference: normalizeOptional(input.authorizationReference),
    note: String(input.note || '').trim(),
    entries,
    totalValueIn,
    totalValueOut,
    processMetrics: input.processMetrics || undefined,
    createdBy: actorId,
  }], { session });
  return transaction;
}

async function idempotentPost(companyId, idempotencyKey, work) {
  const existing = await findExisting(companyId, idempotencyKey);
  if (existing) return { transaction: existing, duplicate: true };
  try {
    return await runTransaction(async session => {
      const inside = await findExisting(companyId, idempotencyKey, session);
      if (inside) return { transaction: inside, duplicate: true };
      const transaction = await work(session);
      return { transaction, duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await findExisting(companyId, idempotencyKey);
      if (duplicate) return { transaction: duplicate, duplicate: true };
    }
    throw error;
  }
}

export async function postReceipt(companyId, actorId, input = {}) {
  const result = await idempotentPost(companyId, input.idempotencyKey, async session => {
    const entry = await receiptLine(companyId, input, session);
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'RECEIPT',
    }, [entry], session);
  });
  const serialIds = (result.transaction?.entries || [])
    .flatMap(entry => entry.serialIds || []);
  result.serials = serialIds.length
    ? await InventorySerialV2.find({ companyId, _id: { $in: serialIds } })
      .select('serialNo catchQuantity catchUom catchSource manufacturedAt traceSnapshot lotId')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  return result;
}

export async function postManualProductionReceipt(companyId, actorId, input = {}) {
  const result = await idempotentPost(companyId, input.idempotencyKey, async session => {
    const item = await loadContext(companyId, input.itemId, input.warehouseId, session);
    if (!item.capabilities?.manufacturable) {
      throw fail(
        'Manual production receipts can only use manufacturable Items',
        409,
        'ITEM_NOT_MANUFACTURABLE',
      );
    }
    const receiptMode = normalizeCode(input.receiptMode);
    if (!['PRODUCTION', 'GATEWAY_FALLBACK'].includes(receiptMode)) {
      throw fail(
        'Manual production receipt type must be Production or Gateway fallback',
        400,
        'INVALID_MANUAL_PRODUCTION_RECEIPT_TYPE',
      );
    }
    if (!input.campaignId) {
      throw fail('Campaign is required for production receipts', 400, 'CAMPAIGN_REQUIRED');
    }
    objectId(input.campaignId, 'campaignId');
    const campaign = await Campaign.findOne({
      _id: input.campaignId,
      companyId,
      status: 'RUNNING',
    }).session(session).select('_id').lean();
    if (!campaign) {
      throw fail(
        'A running Campaign is required for manual production receipts',
        409,
        'RUNNING_CAMPAIGN_REQUIRED',
      );
    }
    if (!validDateOrNull(input.manufacturedAt, 'manufacturedAt')) {
      throw fail(
        'Manufacture date and time is required',
        400,
        'MANUFACTURED_AT_REQUIRED',
      );
    }
    if (!normalizeOptional(input.manualReason)) {
      throw fail(
        'A reason is required for every manual production receipt',
        400,
        'MANUAL_PRODUCTION_REASON_REQUIRED',
      );
    }
    const entry = await receiptLine(companyId, {
      ...input,
      sourceType: 'MANUAL_RECEIPT',
      qualityStatus: 'AVAILABLE',
      processStatus: 'AVAILABLE',
      receiptMode,
    }, session);
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'RECEIPT',
      referenceType: receiptMode === 'GATEWAY_FALLBACK'
        ? 'GATEWAY_FALLBACK'
        : 'MANUAL_PRODUCTION',
    }, [entry], session);
  });
  const serialIds = (result.transaction?.entries || [])
    .flatMap(entry => entry.serialIds || []);
  result.serials = serialIds.length
    ? await InventorySerialV2.find({ companyId, _id: { $in: serialIds } })
      .select('serialNo catchQuantity catchUom catchSource manufacturedAt traceSnapshot lotId')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  return result;
}

export async function postOpeningStockAdjustment(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    if (!normalizeOptional(input.reason)) {
      throw fail('Adjustment reason is required', 400, 'ADJUSTMENT_REASON_REQUIRED');
    }
    if (!normalizeOptional(input.referenceId)) {
      throw fail('Adjustment reference is required', 400, 'ADJUSTMENT_REFERENCE_REQUIRED');
    }
    if (!normalizeOptional(input.authorizationReference)) {
      throw fail(
        'Approval or authorization reference is required',
        400,
        'ADJUSTMENT_AUTHORIZATION_REQUIRED',
      );
    }
    if (input.unitCost === null || input.unitCost === undefined || input.unitCost === '') {
      throw fail('Opening stock valuation is required', 400, 'ADJUSTMENT_VALUATION_REQUIRED');
    }
    nonNegative(input.unitCost, 'unitCost');
    const effectiveAt = validDateOrNull(input.effectiveAt, 'effectiveAt') || new Date();
    const auditNote = [
      `Reason: ${String(input.reason).trim()}`,
      `Authorization: ${String(input.authorizationReference).trim()}`,
      normalizeOptional(input.note),
    ].filter(Boolean).join(' | ');
    const entry = await receiptLine(companyId, {
      ...input,
      sourceType: 'OPENING_STOCK',
      sourceId: String(input.referenceId).trim(),
      qualityStatus: normalizeCode(input.qualityStatus) || 'AVAILABLE',
      processStatus: normalizeCode(input.qualityStatus) === 'REJECTED'
        ? 'REJECTED'
        : 'AVAILABLE',
      receivedAt: effectiveAt,
    }, session, { skipSerials: true });
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'ADJUSTMENT',
      effectiveAt,
      referenceType: 'OPENING_STOCK_ADJUSTMENT',
      referenceId: String(input.referenceId).trim(),
      note: auditNote,
    }, [entry], session);
  });
}

export async function postGatewayPackedBlanketReceipt(companyId, actorId, input = {}) {
  const result = await idempotentPost(companyId, input.idempotencyKey, async session => {
    const blanket = await ItemMaster.findOne({
      _id: input.itemId,
      companyId,
      status: 'active',
      'capabilities.inventory': true,
      'capabilities.manufacturable': true,
    }).populate('familyId', 'code').session(session).lean();
    if (!blanket || blanket.familyId?.code !== 'BLANKET') {
      throw fail(
        'Automatic gateway packing is only available for active manufacturable Blanket Items',
        409,
        'GATEWAY_PACKING_ITEM_INVALID',
      );
    }
    const quantity = positive(input.quantity, 'quantity');
    enforceWholeUnit(blanket, quantity);
    const recipe = await ManufacturingRecipeV2.findOne({
      companyId,
      outputItemId: blanket._id,
      status: 'ACTIVE',
    }).populate({
      path: 'components.itemId',
      select: 'sku name baseUom status capabilities familyId itemClassId',
      populate: [
        { path: 'familyId', select: 'code' },
        { path: 'itemClassId', select: 'code' },
      ],
    }).session(session).lean();
    if (!recipe) {
      throw fail(
        'An active Blanket recipe with Plastic Bag packing is required before gateway stock can post',
        409,
        'GATEWAY_BLANKET_RECIPE_REQUIRED',
      );
    }
    const manufacturedAt = validDateOrNull(input.manufacturedAt, 'manufacturedAt') || new Date();
    if (
      (recipe.effectiveFrom && manufacturedAt < new Date(recipe.effectiveFrom))
      || (recipe.effectiveTo && manufacturedAt > new Date(recipe.effectiveTo))
    ) {
      throw fail(
        'The active Blanket recipe is not effective at the PLC manufacture time',
        409,
        'GATEWAY_BLANKET_RECIPE_NOT_EFFECTIVE',
      );
    }
    const plasticComponents = (recipe.components || []).filter(component =>
      normalizeCode(component.stage) === 'PACKING'
      && component.itemId?.familyId?.code === 'PLASTIC_BAG');
    if (!plasticComponents.length) {
      throw fail(
        'The active Blanket recipe must contain a PLASTIC_BAG component at the PACKING stage',
        409,
        'GATEWAY_PLASTIC_BAG_COMPONENT_REQUIRED',
      );
    }
    if (plasticComponents.some(component =>
      component.itemId?.status !== 'active'
      || !component.itemId?.capabilities?.inventory
      || !component.itemId?.capabilities?.consumable
      || component.itemId?.itemClassId?.code !== 'PACKAGING')) {
      throw fail(
        'Gateway Plastic Bag components must be active, inventory-enabled consumable Packaging Items',
        409,
        'GATEWAY_PLASTIC_BAG_COMPONENT_INVALID',
      );
    }
    const plasticPerRoll = roundQuantity(plasticComponents.reduce(
      (total, component) => total + Number(component.quantity || 0) / Number(recipe.basisQuantity),
      0,
    ));
    if (Math.abs(plasticPerRoll - 1) > EPSILON) {
      throw fail(
        'The active Blanket recipe must consume exactly one Plastic Bag per roll',
        409,
        'GATEWAY_PLASTIC_BAG_QUANTITY_INVALID',
        { configuredPerRoll: plasticPerRoll },
      );
    }
    const grouped = new Map();
    for (const component of plasticComponents) {
      const itemId = String(component.itemId._id);
      const perRoll = Number(component.quantity) / Number(recipe.basisQuantity);
      grouped.set(itemId, roundQuantity((grouped.get(itemId)?.quantity || 0) + perRoll));
      grouped.get(itemId).item = component.itemId;
    }
    const normalizedComponents = [...grouped.entries()]
      .map(([itemId, value]) => ({
        itemId,
        quantity: value.quantity,
        uom: value.item.baseUom,
      }))
      .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)));
    const packingLabel = 'Plastic Bag';
    const packingKey = `PACK-${crypto.createHash('sha256')
      .update(`${packingLabel.toLowerCase()}|${normalizedComponents
        .map(row => `${row.itemId}:${row.quantity}`).join('|')}`)
      .digest('hex').slice(0, 20).toUpperCase()}`;
    const entries = [];
    for (const component of normalizedComponents) {
      entries.push(await issueLine(companyId, {
        itemId: component.itemId,
        warehouseId: input.packagingWarehouseId || input.warehouseId,
        quantity: roundQuantity(component.quantity * quantity),
        qualityStatus: 'AVAILABLE',
      }, session));
    }
    const packagingValue = roundMoney(entries.reduce(
      (total, entry) => total + Number(entry.value || 0),
      0,
    ));
    const baseOutputValue = roundMoney(quantity * nonNegative(input.unitCost ?? 0, 'unitCost'));
    const packedLotNo = input.lotNo
      ? `${normalizeCode(input.lotNo).slice(0, 96)}-PB`
      : undefined;
    const receipt = await receiptLine(companyId, {
      ...input,
      quantity,
      lotNo: packedLotNo,
      unitCost: roundMoney((baseOutputValue + packagingValue) / quantity),
      qualityStatus: 'AVAILABLE',
      processStatus: 'PACKED',
      sourceType: 'PROD_GATEWAY',
    }, session);
    await InventoryLotV2.updateOne(
      { _id: receipt.lotId, companyId },
      {
        $set: {
          packingLabel,
          packingKey,
          packagingComponents: normalizedComponents,
        },
      },
      { session },
    );
    entries.push(receipt);
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'CONVERSION',
      referenceType: 'PROD_GATEWAY_PACKED_BLANKET',
    }, entries, session);
  });
  const serialIds = (result.transaction?.entries || [])
    .flatMap(entry => entry.serialIds || []);
  result.serials = serialIds.length
    ? await InventorySerialV2.find({ companyId, _id: { $in: serialIds } })
      .select('serialNo catchQuantity catchUom catchSource manufacturedAt traceSnapshot lotId')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  return result;
}

/**
 * Posts a receipt inside a caller-owned MongoDB transaction. This is used by
 * procurement so the GRN, purchase order and inventory transaction commit as
 * one atomic operation.
 */
export async function postReceiptInSession(
  companyId,
  actorId,
  input = {},
  session,
) {
  if (!session) throw fail('A MongoDB session is required', 500, 'SESSION_REQUIRED');
  const existing = await findExisting(companyId, input.idempotencyKey, session);
  if (existing) return { transaction: existing, duplicate: true };
  const entry = await receiptLine(companyId, input, session);
  const transaction = await createPostedTransaction(companyId, actorId, {
    ...input,
    type: 'RECEIPT',
  }, [entry], session);
  return { transaction, duplicate: false };
}

export async function postIssue(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    const entry = await issueLine(companyId, input, session);
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'ISSUE',
    }, [entry], session);
  });
}

/** Posts an issue inside a caller-owned MongoDB transaction. */
export async function postIssueInSession(
  companyId,
  actorId,
  input = {},
  session,
) {
  if (!session) throw fail('A MongoDB session is required', 500, 'SESSION_REQUIRED');
  const existing = await findExisting(companyId, input.idempotencyKey, session);
  if (existing) return { transaction: existing, duplicate: true };
  const entry = await issueLine(companyId, input, session);
  const transaction = await createPostedTransaction(companyId, actorId, {
    ...input,
    type: 'ISSUE',
  }, [entry], session);
  return { transaction, duplicate: false };
}

export async function postMaterialIssue(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    if (!Array.isArray(input.lines) || !input.lines.length) {
      throw fail('At least one material issue line is required', 400, 'ISSUE_LINES_REQUIRED');
    }
    const entries = [];
    for (const line of input.lines) {
      entries.push(await issueLine(companyId, line, session));
    }
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'ISSUE',
    }, entries, session);
  });
}

export async function postTransfer(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    if (String(input.fromWarehouseId) === String(input.toWarehouseId)
      && normalizeOptional(input.fromBin) === normalizeOptional(input.toBin)) {
      throw fail('Transfer destination must differ from source', 400, 'INVALID_TRANSFER');
    }
    const issue = await issueLine(companyId, {
      ...input,
      warehouseId: input.fromWarehouseId,
      bin: input.fromBin,
    }, session, { updateAccounting: false });
    const entries = [issue];
    for (const allocation of issue.allocations) {
      const receipt = await receiptLine(companyId, {
        ...input,
        warehouseId: input.toWarehouseId,
        bin: input.toBin,
        quantity: allocation.quantity,
        catchQuantity: allocation.catchQuantity,
        lotNo: allocation.lotNo,
        unitCost: allocation.unitCost,
        sourceType: 'TRANSFER',
        parentLotIds: [allocation.lotId],
      }, session, { updateAccounting: false, skipSerials: true });
      entries.push(receipt);
    }
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'TRANSFER',
    }, entries, session);
  });
}

export async function postConversion(companyId, actorId, input = {}) {
  const result = await idempotentPost(companyId, input.idempotencyKey, async session => {
    if (!Array.isArray(input.inputs) || !input.inputs.length) {
      throw fail('Conversion requires at least one input', 400, 'CONVERSION_INPUT_REQUIRED');
    }
    if (!Array.isArray(input.outputs) || !input.outputs.length) {
      throw fail('Conversion requires at least one output', 400, 'CONVERSION_OUTPUT_REQUIRED');
    }
    const entries = [];
    for (const row of input.inputs) {
      entries.push(await issueLine(companyId, row, session));
    }
    const inputValue = roundMoney(entries.reduce((total, entry) => total + entry.value, 0));
    const outputQuantities = input.outputs.map(output => positive(output.quantity, 'output.quantity'));
    const allocationWeights = input.outputs.map((output, index) => {
      const weight = output.costAllocationWeight === undefined
        ? outputQuantities[index]
        : positive(output.costAllocationWeight, 'costAllocationWeight');
      return weight;
    });
    const totalWeight = allocationWeights.reduce((total, weight) => total + weight, 0);
    let allocatedValue = 0;
    for (let index = 0; index < input.outputs.length; index += 1) {
      const output = input.outputs[index];
      const quantity = outputQuantities[index];
      const value = index === input.outputs.length - 1
        ? roundMoney(inputValue - allocatedValue)
        : roundMoney(inputValue * allocationWeights[index] / totalWeight);
      allocatedValue = roundMoney(allocatedValue + value);
      entries.push(await receiptLine(companyId, {
        ...output,
        quantity,
        unitCost: quantity ? value / quantity : 0,
        sourceType: 'CONVERSION',
        sourceId: input.referenceId,
        parentLotIds: entries
          .filter(entry => entry.direction === 'OUT')
          .flatMap(entry => entry.allocations.map(allocation => allocation.lotId)),
      }, session));
    }
    let processMetrics;
    if (input.captureWeightYield) {
      const weightKg = entry => {
        if (entry.baseUom === 'kg') return Number(entry.quantity || 0);
        if (entry.catchUom === 'kg') return Number(entry.catchQuantity || 0);
        throw fail(
          'Weight yield can only be captured from kg base/catch quantities',
          409,
          'WEIGHT_YIELD_UOM_MISMATCH',
        );
      };
      const inputWeightKg = roundQuantity(entries
        .filter(entry => entry.direction === 'OUT')
        .reduce((total, entry) => total + weightKg(entry), 0));
      const outputWeightKg = roundQuantity(entries
        .filter(entry => entry.direction === 'IN')
        .reduce((total, entry) => total + weightKg(entry), 0));
      processMetrics = {
        inputWeightKg,
        outputWeightKg,
        processLossKg: roundQuantity(inputWeightKg - outputWeightKg),
        yieldPercent: inputWeightKg > 0
          ? roundQuantity(outputWeightKg / inputWeightKg * 100)
          : null,
      };
    }
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'CONVERSION',
      processMetrics,
    }, entries, session);
  });
  const serialIds = (result.transaction?.entries || [])
    .flatMap(entry => entry.serialIds || []);
  result.serials = serialIds.length
    ? await InventorySerialV2.find({ companyId, _id: { $in: serialIds } })
      .select('serialNo catchQuantity catchUom catchSource manufacturedAt traceSnapshot lotId')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  return result;
}

export async function postBlanketPacking(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    objectId(input.itemId, 'itemId');
    objectId(input.warehouseId, 'warehouseId');
    const quantity = positive(input.quantity, 'quantity');
    const packingLabel = String(input.packingLabel || '').replace(/\s+/g, ' ').trim();
    if (!packingLabel || packingLabel.length > 180) {
      throw fail(
        'Packing name is required and must not exceed 180 characters',
        400,
        'PACKING_LABEL_REQUIRED',
      );
    }
    if (!Array.isArray(input.packaging) || !input.packaging.length) {
      throw fail(
        'Select at least one packaging material',
        400,
        'PACKAGING_COMPONENT_REQUIRED',
      );
    }

    const [blanket, family] = await Promise.all([
      loadContext(companyId, input.itemId, input.warehouseId, session),
      ItemFamily.findOne({ companyId, code: 'BLANKET', status: 'active' })
        .session(session).select('_id').lean(),
    ]);
    if (!blanket || !family || String(blanket.familyId) !== String(family._id)) {
      throw fail('Selected Item is not an active Blanket Item', 409, 'NOT_A_BLANKET_ITEM');
    }
    enforceWholeUnit(blanket, quantity);

    const grouped = new Map();
    for (const row of input.packaging) {
      objectId(row.itemId, 'packaging.itemId');
      const quantityPerUnit = positive(
        row.quantityPerUnit ?? row.quantity,
        'packaging.quantityPerUnit',
      );
      const key = String(row.itemId);
      grouped.set(key, roundQuantity((grouped.get(key) || 0) + quantityPerUnit));
    }
    const componentIds = [...grouped.keys()];
    const componentItems = await ItemMaster.find({
      _id: { $in: componentIds },
      companyId,
      status: 'active',
      'capabilities.inventory': true,
      'capabilities.consumable': true,
    }).populate('itemClassId', 'code').session(session).lean();
    if (
      componentItems.length !== componentIds.length
      || componentItems.some(item => item.itemClassId?.code !== 'PACKAGING')
    ) {
      throw fail(
        'Every packing component must be an active Packaging Material Item',
        409,
        'INVALID_PACKAGING_COMPONENT',
      );
    }
    const componentById = new Map(componentItems.map(item => [String(item._id), item]));
    const normalizedComponents = componentIds
      .map(itemId => ({
        itemId,
        quantity: grouped.get(itemId),
        uom: componentById.get(itemId).baseUom,
      }))
      .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)));
    const packingKey = `PACK-${crypto.createHash('sha256')
      .update(`${packingLabel.toLowerCase()}|${normalizedComponents
        .map(row => `${row.itemId}:${row.quantity}`).join('|')}`)
      .digest('hex').slice(0, 20).toUpperCase()}`;

    const fromPackingKey = normalizeCode(input.fromPackingKey) || 'UNPACKED';
    const blanketIssue = await issueLine(companyId, {
      itemId: blanket._id,
      warehouseId: input.warehouseId,
      bin: input.bin,
      quantity,
      qualityStatus: 'AVAILABLE',
      processStatus: fromPackingKey === 'UNPACKED' ? 'AVAILABLE' : 'PACKED',
      packingKey: fromPackingKey,
    }, session, { updateAccounting: false });
    const entries = [blanketIssue];
    for (const component of normalizedComponents) {
      entries.push(await issueLine(companyId, {
        itemId: component.itemId,
        warehouseId: input.packagingWarehouseId || input.warehouseId,
        quantity: roundQuantity(component.quantity * quantity),
        qualityStatus: 'AVAILABLE',
      }, session));
    }
    const packagingValue = roundMoney(entries
      .slice(1)
      .reduce((total, entry) => total + Number(entry.value || 0), 0));
    const outputValue = roundMoney(Number(blanketIssue.value || 0) + packagingValue);
    const packedLotNo = normalizeCode(input.outputLotNo)
      || `${blanket.sku}-PK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const packedReceipt = await receiptLine(companyId, {
      itemId: blanket._id,
      warehouseId: input.warehouseId,
      bin: input.bin,
      quantity,
      catchQuantity: blanketIssue.catchQuantity,
      allowMissingCatchQuantity: blanketIssue.catchQuantity === null,
      lotNo: packedLotNo,
      unitCost: outputValue / quantity,
      qualityStatus: 'AVAILABLE',
      processStatus: 'PACKED',
      sourceType: 'BLANKET_PACKING',
      sourceId: input.referenceId || null,
      parentLotIds: blanketIssue.allocations.map(allocation => allocation.lotId),
    }, session, { updateAccounting: false, skipSerials: true });
    await InventoryLotV2.updateOne(
      { _id: packedReceipt.lotId, companyId },
      {
        $set: {
          packingLabel,
          packingKey,
          packagingComponents: normalizedComponents,
        },
      },
      { session },
    );
    if (packagingValue > 0) {
      await addAccountingValue(companyId, blanket._id, 0, packagingValue, session);
    }
    entries.push(packedReceipt);
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'CONVERSION',
      referenceType: input.referenceType || 'BLANKET_PACKING',
      referenceId: input.referenceId || packedLotNo,
    }, entries, session);
  });
}

const PROCESS_TRANSITIONS = Object.freeze({
  AVAILABLE: ['REJECTED'],
  DRAWN: ['DRYING'],
  DRYING: ['DRIED_AWAITING_QC'],
  DRIED_AWAITING_QC: ['EDGED', 'REJECTED'],
  EDGED: ['PACKED', 'REJECTED'],
  PACKED: ['REJECTED'],
});

export async function transitionLotProcess(companyId, actorId, input = {}) {
  return idempotentPost(companyId, input.idempotencyKey, async session => {
    objectId(input.lotId, 'lotId');
    const lot = await InventoryLotV2.findOne({
      _id: input.lotId,
      companyId,
      status: 'OPEN',
      onHandQuantity: { $gt: 0 },
    }).session(session);
    if (!lot) throw fail('Open inventory lot was not found', 404, 'INVENTORY_LOT_NOT_FOUND');
    const toProcessStatus = normalizeCode(input.toProcessStatus);
    if (!(PROCESS_TRANSITIONS[lot.processStatus] || []).includes(toProcessStatus)) {
      throw fail(
        `Invalid process transition: ${lot.processStatus} → ${toProcessStatus}`,
        409,
        'INVALID_PROCESS_TRANSITION',
      );
    }
    const toQualityStatus = normalizeCode(input.toQualityStatus)
      || (toProcessStatus === 'REJECTED' ? 'REJECTED' : lot.qualityStatus);
    if (lot.qualityStatus === 'REJECTED' && toQualityStatus === 'AVAILABLE') {
      throw fail('Rejected material cannot return to accepted stock', 409, 'QUALITY_UPGRADE_NOT_ALLOWED');
    }
    if (['EDGED', 'PACKED'].includes(toProcessStatus) && toQualityStatus !== 'AVAILABLE') {
      throw fail(
        `${toProcessStatus} stock must pass quality inspection first`,
        409,
        'QUALITY_GATE_REQUIRED',
      );
    }
    const item = await ItemMaster.findById(lot.itemId).session(session).lean();
    if (!item) throw fail('Lot Item was not found', 409, 'INVENTORY_ITEM_NOT_FOUND');
    const quantity = lot.onHandQuantity;
    const catchQuantity = lot.onHandCatchQuantity;
    const fromProcessStatus = lot.processStatus;
    const fromQualityStatus = lot.qualityStatus;
    await applyBalance({
      companyId,
      item,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      lot,
      qualityStatus: lot.qualityStatus,
      processStatus: lot.processStatus,
      quantityDelta: -quantity,
      catchDelta: catchQuantity === null ? null : -catchQuantity,
      session,
    });
    lot.processStatus = toProcessStatus;
    lot.qualityStatus = toQualityStatus;
    await lot.save({ session });
    await applyBalance({
      companyId,
      item,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      lot,
      qualityStatus: lot.qualityStatus,
      processStatus: lot.processStatus,
      quantityDelta: quantity,
      catchDelta: catchQuantity,
      session,
    });
    const common = {
      itemId: item._id,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      quantity,
      catchQuantity,
      baseUom: item.baseUom,
      catchUom: item.catchUom || null,
      unitCost: lot.unitCost,
      value: lot.remainingValue,
      lotId: lot._id,
      lotNo: lot.lotNo,
      allocations: [],
    };
    return createPostedTransaction(companyId, actorId, {
      ...input,
      type: 'QUALITY_CHANGE',
    }, [
      {
        ...common,
        direction: 'OUT',
        qualityStatus: fromQualityStatus,
        processStatus: fromProcessStatus,
      },
      {
        ...common,
        direction: 'IN',
        qualityStatus: toQualityStatus,
        processStatus: toProcessStatus,
      },
    ], session);
  });
}

export async function listStockV2(companyId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const filter = { companyId };
  if (query.search) {
    const tokens = String(query.search)
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9°]+/)
      .filter(Boolean)
      .map(token => token.slice(0, 24))
      .slice(0, 8);
    if (tokens.length) {
      filter.itemId = {
        $in: await ItemMaster.find({
          companyId,
          searchTokens: { $all: tokens },
        }).distinct('_id'),
      };
    }
  }
  if (query.itemId) filter.itemId = query.itemId;
  if (query.warehouseId) filter.warehouseId = query.warehouseId;
  if (query.qualityStatus) filter.qualityStatus = normalizeCode(query.qualityStatus);
  if (query.positiveOnly !== 'false') filter.onHand = { $gt: 0 };
  const rows = await InventoryBalanceV2.find(filter)
    .populate({
      path: 'itemId',
      select: 'sku name baseUom catchUom familyId itemClassId',
      populate: { path: 'familyId', select: 'code name' },
    })
    .populate('warehouseId', 'code name')
    .populate({
      path: 'lotId',
      select: 'lotNo receivedAt expiresAt unitCost supplierLotNo packingLabel packingKey packagingComponents',
      populate: { path: 'packagingComponents.itemId', select: 'sku name baseUom' },
    })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return rows;
}

export async function listTransactionsV2(companyId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const filter = { companyId };
  if (query.type) filter.type = normalizeCode(query.type);
  if (query.itemId) filter['entries.itemId'] = query.itemId;
  return InventoryTransactionV2.find(filter)
    .populate('entries.itemId', 'sku name')
    .populate('entries.warehouseId', 'code name')
    .sort({ effectiveAt: -1, _id: -1 })
    .limit(limit)
    .lean();
}

export async function listSerialsV2(companyId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 1000);
  const filter = { companyId };
  if (query.state) filter.state = normalizeCode(query.state);
  if (query.qualityStatus) filter.qualityStatus = normalizeCode(query.qualityStatus);
  if (query.itemId) filter.itemId = query.itemId;
  if (query.warehouseId) filter.warehouseId = query.warehouseId;
  if (query.serialNo) filter.serialNo = String(query.serialNo).trim();
  if (query.familyCode) {
    const family = await ItemFamily.findOne({
      companyId,
      code: normalizeCode(query.familyCode),
      status: 'active',
    }).select('_id').lean();
    filter.itemId = family
      ? { $in: await ItemMaster.find({ companyId, familyId: family._id }).distinct('_id') }
      : { $in: [] };
  }
  if (query.packingKey) {
    const packingKey = normalizeCode(query.packingKey);
    filter.lotId = {
      $in: await InventoryLotV2.find({
        companyId,
        packingKey: packingKey === 'UNPACKED' ? null : packingKey,
      }).distinct('_id'),
    };
  }
  return InventorySerialV2.find(filter)
    .populate('itemId', 'sku name attributes baseUom catchUom')
    .populate('warehouseId', 'code name')
    .populate('campaignId', 'name startDate endDate status')
    .populate({
      path: 'lotId',
      select: 'lotNo processStatus qualityStatus packingLabel packingKey packagingComponents manufacturedAt campaignId',
      populate: { path: 'packagingComponents.itemId', select: 'sku name baseUom' },
    })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();
}

export async function publicSerialTrace(serialNo) {
  const normalized = String(serialNo || '').trim();
  if (!isValidInventorySerial(normalized)) {
    throw fail('Serial number is invalid', 404, 'SERIAL_NOT_FOUND');
  }
  const serial = await InventorySerialV2.findOne({ serialNo: normalized })
    .select(
      'serialNo state qualityStatus catchQuantity catchUom catchSource manufacturedAt '
      + 'traceSnapshot campaignId lotId itemId companyId parentSerialId'
    )
    .populate('campaignId', 'name')
    .populate('lotId', 'lotNo')
    .populate('itemId', 'sku name attributes')
    .populate('companyId', 'companyName')
    .lean();
  if (!serial) throw fail('Serial number was not found', 404, 'SERIAL_NOT_FOUND');
  const snapshot = serial.traceSnapshot || {};
  return {
    valid: true,
    serialNo: serial.serialNo,
    product: {
      name: snapshot.productName || serial.itemId?.name,
      sku: snapshot.sku || serial.itemId?.sku,
      specifications: snapshot.specifications || (serial.itemId?.attributes || []).map(attribute => ({
        code: attribute.code,
        label: humanizeAttribute(attribute.code),
        value: attribute.displayValue || attribute.normalizedValue,
        unit: attribute.unit || null,
      })),
    },
    manufacturerName: snapshot.manufacturerName || serial.companyId?.companyName,
    campaignName: snapshot.campaignName || serial.campaignId?.name || null,
    lotNo: snapshot.lotNo || serial.lotId?.lotNo,
    manufacturedAt: serial.manufacturedAt,
    weight: serial.catchQuantity,
    weightUom: serial.catchUom,
    weightSource: serial.catchSource,
    qualityStatus: serial.qualityStatus,
    lifecycleStatus: serial.state,
    derivedFromAnotherSerial: Boolean(serial.parentSerialId),
  };
}

export async function inventoryV2Summary(companyId) {
  const [stock, costs] = await Promise.all([
    InventoryBalanceV2.aggregate([
      { $match: { companyId } },
      {
        $group: {
          _id: {
            qualityStatus: '$qualityStatus',
            baseUom: '$baseUom',
          },
          quantity: { $sum: '$onHand' },
          available: { $sum: '$available' },
          buckets: { $sum: 1 },
        },
      },
    ]),
    InventoryCostBalance.aggregate([
      { $match: { companyId } },
      {
        $group: {
          _id: null,
          inventoryValue: { $sum: '$inventoryValue' },
          stockedItems: { $sum: { $cond: [{ $gt: ['$quantity', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);
  return {
    stock,
    inventoryValue: costs[0]?.inventoryValue || 0,
    stockedItems: costs[0]?.stockedItems || 0,
  };
}

export async function inventoryReceiptContext(companyId) {
  return {
    campaigns: await Campaign.find({ companyId, status: 'RUNNING' })
      .select('_id name startDate endDate status')
      .sort({ startDate: -1, _id: -1 })
      .lean(),
    serialPolicy: {
      digits: 16,
      generatedBy: 'BACKEND',
      maxUnitsPerReceipt: 1000,
    },
  };
}
