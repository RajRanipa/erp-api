import mongoose from 'mongoose';
import InventoryBalance from '../models/InventoryBalance.js';
import ItemMaster from '../models/ItemMaster.js';
import Warehouse from '../models/Warehouse.js';
import { sendTextMessage } from './whatsappService.js';

const EPSILON = 1e-9;
const pendingTransactions = new WeakMap();
const pendingFailureAlerts = new WeakMap();
const alertRecipient = () => (
  String(process.env.INVENTORY_ALERT_WHATSAPP_NUMBER || '919327622916').replace(/\D/g, '')
);
const number = value => Number(value || 0);
const displayNumber = value => new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 3,
}).format(number(value));
const displayDateTime = value => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(value ? new Date(value) : new Date());

const itemLabel = item => `${item?.name || 'Unknown item'} (${item?.sku || item?._id || 'unknown'})`;
const optionalLine = (label, value) => value ? `${label}: ${value}` : null;

export function buildLowStockMessage({
  item,
  stock,
  movement,
  transaction,
  warehouseNames = [],
}) {
  const minimum = number(item.minimumStock);
  const available = number(stock.available);
  const shortage = Math.max(0, minimum - available);
  const movementLabel = movement.netQuantity > 0 ? 'IN' : 'OUT';
  const availableMovementLabel = movement.availableDelta > 0 ? 'IN' : 'OUT';
  return [
    '⚠️ ERP LOW STOCK ALERT',
    `Item: ${itemLabel(item)}`,
    optionalLine('Class', item.itemClassId?.name || item.itemClassId?.code),
    optionalLine('Family', item.familyId?.name || item.familyId?.code),
    `Available stock: ${displayNumber(available)} ${item.baseUom}`,
    `Physical on hand: ${displayNumber(stock.onHand)} ${item.baseUom}`,
    `Minimum stock: ${displayNumber(minimum)} ${item.baseUom}`,
    `Shortage: ${displayNumber(shortage)} ${item.baseUom}`,
    Math.abs(movement.netQuantity) > EPSILON
      ? `Latest movement: ${movementLabel} ${displayNumber(Math.abs(movement.netQuantity))} ${item.baseUom}`
      : null,
    Number.isFinite(movement.availableDelta)
      && Math.abs(movement.availableDelta) > EPSILON
      && Math.abs(movement.availableDelta - movement.netQuantity) > EPSILON
      ? `Usable-stock change: ${availableMovementLabel} ${displayNumber(Math.abs(movement.availableDelta))} ${item.baseUom}`
      : null,
    optionalLine('Warehouse', warehouseNames.join(', ')),
    optionalLine('Transaction', transaction?.transactionNo),
    optionalLine('Reference', [transaction?.referenceType, transaction?.referenceId]
      .filter(Boolean).join(' / ')),
    `Checked at: ${displayDateTime()}`,
    'Action: Replenish this item or correct its minimum-stock setting.',
  ].filter(Boolean).join('\n');
}

export function buildInsufficientAccountingStockMessage({
  item,
  requestedQuantity,
  balance,
  context = {},
  operationalStock = {},
  warehouseName = null,
}) {
  const availableAccounting = number(balance?.quantity);
  const shortage = Math.max(0, number(requestedQuantity) - availableAccounting);
  const averageCost = number(balance?.movingAverageCost);
  return [
    '🚫 ERP INVENTORY ISSUE BLOCKED',
    'Reason: Accounting stock is insufficient for this issue.',
    `Item: ${itemLabel(item)}`,
    `Requested issue: ${displayNumber(requestedQuantity)} ${item?.baseUom || 'unit'}`,
    `Accounting stock: ${displayNumber(availableAccounting)} ${item?.baseUom || 'unit'}`,
    `Operational available: ${displayNumber(operationalStock.available)} ${item?.baseUom || 'unit'}`,
    `Physical on hand: ${displayNumber(operationalStock.onHand)} ${item?.baseUom || 'unit'}`,
    `Shortage: ${displayNumber(shortage)} ${item?.baseUom || 'unit'}`,
    `Moving average cost: ${displayNumber(averageCost)} ${balance?.currency || 'INR'} per ${item?.baseUom || 'unit'}`,
    `Requested accounting value: ${displayNumber(number(requestedQuantity) * averageCost)} ${balance?.currency || 'INR'}`,
    optionalLine('Warehouse', warehouseName),
    optionalLine('Operation', context.operation),
    optionalLine('Reference', [context.referenceType, context.referenceId]
      .filter(Boolean).join(' / ')),
    `Detected at: ${displayDateTime()}`,
    'Action: Receive or adjust accounting stock, reconcile it with operational stock, then retry.',
  ].filter(Boolean).join('\n');
}

async function operationalStock(companyId, itemId) {
  const companyObjectId = companyId instanceof mongoose.Types.ObjectId
    ? companyId
    : new mongoose.Types.ObjectId(companyId);
  const itemObjectId = itemId instanceof mongoose.Types.ObjectId
    ? itemId
    : new mongoose.Types.ObjectId(itemId);
  const [stock] = await InventoryBalance.aggregate([
    { $match: { companyId: companyObjectId, itemId: itemObjectId } },
    {
      $group: {
        _id: null,
        onHand: { $sum: '$onHand' },
        available: { $sum: '$available' },
      },
    },
  ]);
  return { onHand: number(stock?.onHand), available: number(stock?.available) };
}

async function safelySend(text, event, details = {}) {
  try {
    await sendTextMessage({ to: alertRecipient(), text });
    console.info(`[inventory-alert:${event}:sent]`, details);
    return true;
  } catch (error) {
    // Inventory posting and its original validation error must never be replaced
    // by a notification-provider/configuration failure.
    console.error(`[inventory-alert:${event}:failed]`, {
      ...details,
      error: error?.message || String(error),
    });
    return false;
  }
}

export async function sendInsufficientAccountingStockAlert({
  companyId,
  item,
  itemId,
  requestedQuantity,
  balance,
  context = {},
}) {
  try {
    const resolvedItem = item || await ItemMaster.findOne({ _id: itemId, companyId })
      .select('name sku baseUom')
      .lean();
    const [stock, warehouse] = await Promise.all([
      operationalStock(companyId, itemId),
      context.warehouseId
        ? Warehouse.findOne({ _id: context.warehouseId, companyId }).select('name code').lean()
        : null,
    ]);
    const text = buildInsufficientAccountingStockMessage({
      item: resolvedItem || { _id: itemId },
      requestedQuantity,
      balance,
      context,
      operationalStock: stock,
      warehouseName: warehouse ? (warehouse.name || warehouse.code) : null,
    });
    return safelySend(text, 'insufficient-accounting-stock', {
      companyId: String(companyId),
      itemId: String(itemId),
      requestedQuantity,
      accountingQuantity: number(balance?.quantity),
    });
  } catch (error) {
    console.error('[inventory-alert:insufficient-accounting-stock:build-failed]', {
      companyId: String(companyId),
      itemId: String(itemId),
      error: error?.message || String(error),
    });
    return false;
  }
}

export function queueInventoryTransactionAlerts(session, transaction) {
  if (!session || !transaction) return;
  const queued = pendingTransactions.get(session) || [];
  queued.push(transaction);
  pendingTransactions.set(session, queued);
}

export function resetInventoryTransactionAlerts(session) {
  if (!session) return;
  pendingTransactions.delete(session);
  pendingFailureAlerts.delete(session);
}

export function queueInsufficientAccountingStockAlert(session, alert) {
  if (!session || !alert) return;
  pendingFailureAlerts.set(session, alert);
}

export function summarizeInventoryMovements(entries = []) {
  const movements = new Map();
  for (const entry of entries) {
    const key = String(entry.itemId);
    const current = movements.get(key) || {
      itemId: entry.itemId,
      netQuantity: 0,
      availableDelta: 0,
      warehouseIds: new Set(),
    };
    const direction = entry.direction === 'IN' ? 1 : -1;
    current.netQuantity += direction * number(entry.quantity);
    if (
      entry.qualityStatus === 'AVAILABLE'
      && ['AVAILABLE', 'PACKED'].includes(entry.processStatus)
    ) {
      current.availableDelta += direction * number(entry.quantity);
    }
    if (entry.warehouseId) current.warehouseIds.add(String(entry.warehouseId));
    movements.set(key, current);
  }
  return [...movements.values()].filter(row => (
    Math.abs(row.netQuantity) > EPSILON || Math.abs(row.availableDelta) > EPSILON
  ));
}

async function sendLowStockAlertsForTransaction(transaction) {
  const companyId = transaction.companyId;
  const changed = summarizeInventoryMovements(transaction.entries);
  if (!changed.length) return;
  const itemIds = changed.map(row => row.itemId);
  const items = await ItemMaster.find({
    _id: { $in: itemIds },
    companyId,
    status: 'active',
    'capabilities.inventory': true,
    minimumStock: { $gt: 0 },
  })
    .select('name sku baseUom minimumStock familyId itemClassId')
    .populate('familyId', 'name code')
    .populate('itemClassId', 'name code')
    .lean();
  const itemById = new Map(items.map(item => [String(item._id), item]));

  for (const movement of changed) {
    const item = itemById.get(String(movement.itemId));
    if (!item) continue;
    const stock = await operationalStock(companyId, movement.itemId);
    if (stock.available + EPSILON >= number(item.minimumStock)) continue;
    const warehouses = movement.warehouseIds.size
      ? await Warehouse.find({ _id: { $in: [...movement.warehouseIds] }, companyId })
        .select('name code')
        .lean()
      : [];
    await safelySend(buildLowStockMessage({
      item,
      stock,
      movement,
      transaction,
      warehouseNames: warehouses.map(row => row.name || row.code),
    }), 'low-stock', {
      companyId: String(companyId),
      itemId: String(item._id),
      transactionNo: transaction.transactionNo,
      available: stock.available,
      minimumStock: item.minimumStock,
    });
  }
}

export async function flushInventoryTransactionAlerts(session) {
  const queued = pendingTransactions.get(session) || [];
  pendingTransactions.delete(session);
  for (const transaction of queued) {
    try {
      await sendLowStockAlertsForTransaction(transaction);
    } catch (error) {
      console.error('[inventory-alert:low-stock:check-failed]', {
        transactionId: String(transaction?._id || ''),
        error: error?.message || String(error),
      });
    }
  }
}

export async function flushInventoryFailureAlerts(session) {
  const alert = pendingFailureAlerts.get(session);
  pendingFailureAlerts.delete(session);
  if (alert) await sendInsufficientAccountingStockAlert(alert);
}
