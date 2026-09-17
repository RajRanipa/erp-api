import mongoose from 'mongoose';
import {
  inventorySummary,
  inventoryReceiptContext,
  listStock,
  listTransactions,
  listSerials,
  postConversion,
  postIssue,
  postBlanketPacking,
  postManualProductionReceipt,
  postOpeningStockAdjustment,
  transitionLotProcess,
  postTransfer,
} from '../services/inventoryService.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'INVENTORY_REQUEST_INVALID') =>
  new AppError(message, { statusCode, code });

const companyIdFromRequest = req => {
  const companyId = req.user?.companyId || req.user?.company?._id || req.user?.company;
  if (!mongoose.isValidObjectId(companyId)) {
    throw fail('A valid company context is required', 401, 'COMPANY_CONTEXT_REQUIRED');
  }
  return companyId;
};

const actorIdFromRequest = req =>
  req.user?.userId || req.user?.id || req.user?._id || null;

const idempotencyInput = req => ({
  ...req.body,
  idempotencyKey: String(
    req.get('Idempotency-Key') || req.body?.idempotencyKey || ''
  ).trim(),
});

export async function getInventoryStock(req, res) {
  try {
    return sendSuccess(res, {
      data: await listStock(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventoryTransactions(req, res) {
  try {
    return sendSuccess(res, {
      data: await listTransactions(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventorySerials(req, res) {
  try {
    return sendSuccess(res, {
      data: await listSerials(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventorySummary(req, res) {
  try {
    return sendSuccess(res, {
      data: await inventorySummary(companyIdFromRequest(req)),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventoryReceiptContext(req, res) {
  try {
    return sendSuccess(res, {
      data: await inventoryReceiptContext(companyIdFromRequest(req)),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

async function post(req, res, operation, message, suppliedInput = null) {
  try {
    const result = await operation(
      companyIdFromRequest(req),
      actorIdFromRequest(req),
      suppliedInput || idempotencyInput(req),
    );
    const sender = result.duplicate ? sendSuccess : sendCreated;
    return sender(res, {
      data: result.transaction,
      message: result.duplicate ? `${message} already posted` : message,
      meta: { duplicate: result.duplicate, serials: result.serials || [] },
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export const createInventoryReceipt = (req, res) =>
  post(req, res, postManualProductionReceipt, 'Manual production receipt posted');

export const createOpeningStockAdjustment = (req, res) =>
  post(req, res, postOpeningStockAdjustment, 'Opening stock adjustment posted');

export const createInventoryIssue = (req, res) =>
  post(req, res, postIssue, 'Inventory issue posted');

export const createInventoryTransfer = (req, res) =>
  post(req, res, postTransfer, 'Inventory transfer posted');

export const createInventoryConversion = (req, res) =>
  post(req, res, postConversion, 'Inventory conversion posted');

export const createBlanketPacking = (req, res) =>
  post(req, res, postBlanketPacking, 'Blanket packing posted');

export const rejectInventoryLot = (req, res) =>
  post(
    req,
    res,
    transitionLotProcess,
    'Inventory lot downgraded to rejected',
    {
      ...idempotencyInput(req),
      lotId: req.params.id,
      toProcessStatus: 'REJECTED',
      toQualityStatus: 'REJECTED',
    },
  );
