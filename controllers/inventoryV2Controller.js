import mongoose from 'mongoose';
import {
  inventoryV2Summary,
  inventoryReceiptContext,
  listStockV2,
  listTransactionsV2,
  listSerialsV2,
  postConversion,
  postIssue,
  postBlanketPacking,
  postReceipt,
  transitionLotProcess,
  postTransfer,
} from '../services/inventoryV2Service.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'INVENTORY_V2_REQUEST_INVALID') =>
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

export async function getInventoryV2Stock(req, res) {
  try {
    return sendSuccess(res, {
      data: await listStockV2(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventoryV2Transactions(req, res) {
  try {
    return sendSuccess(res, {
      data: await listTransactionsV2(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventoryV2Serials(req, res) {
  try {
    return sendSuccess(res, {
      data: await listSerialsV2(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getInventoryV2Summary(req, res) {
  try {
    return sendSuccess(res, {
      data: await inventoryV2Summary(companyIdFromRequest(req)),
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

export const createInventoryV2Receipt = (req, res) =>
  post(req, res, postReceipt, 'Inventory receipt posted');

export const createInventoryV2Issue = (req, res) =>
  post(req, res, postIssue, 'Inventory issue posted');

export const createInventoryV2Transfer = (req, res) =>
  post(req, res, postTransfer, 'Inventory transfer posted');

export const createInventoryV2Conversion = (req, res) =>
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
