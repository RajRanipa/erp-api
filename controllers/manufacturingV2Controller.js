import mongoose from 'mongoose';
import {
  activateRecipe,
  advanceBoardLot,
  createProductionOrder,
  createRecipe,
  drawBoard,
  getProductionOrder,
  inspectBoardLot,
  listProductionOrders,
  listRecipes,
  packBoardLot,
  processChopping,
  releaseProductionOrder,
} from '../services/manufacturingV2Service.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'MANUFACTURING_V2_REQUEST_INVALID') =>
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
const requestInput = req => ({
  ...req.body,
  idempotencyKey: String(
    req.get('Idempotency-Key') || req.body?.idempotencyKey || ''
  ).trim() || undefined,
});

const execute = handler => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const createManufacturingRecipe = execute(async (req, res) =>
  sendCreated(res, {
    data: await createRecipe(companyIdFromRequest(req), actorIdFromRequest(req), req.body),
    message: 'Manufacturing recipe created as Draft',
  }));

export const activateManufacturingRecipe = execute(async (req, res) =>
  sendSuccess(res, {
    data: await activateRecipe(companyIdFromRequest(req), req.params.id, actorIdFromRequest(req)),
    message: 'Manufacturing recipe activated',
  }));

export const getManufacturingRecipes = execute(async (req, res) =>
  sendSuccess(res, { data: await listRecipes(companyIdFromRequest(req), req.query) }));

export const createManufacturingOrder = execute(async (req, res) =>
  sendCreated(res, {
    data: await createProductionOrder(
      companyIdFromRequest(req),
      actorIdFromRequest(req),
      req.body,
    ),
    message: 'Production Order created as Draft',
  }));

export const getManufacturingOrders = execute(async (req, res) =>
  sendSuccess(res, {
    data: await listProductionOrders(companyIdFromRequest(req), req.query),
  }));

export const getManufacturingOrder = execute(async (req, res) =>
  sendSuccess(res, {
    data: await getProductionOrder(companyIdFromRequest(req), req.params.id),
  }));

export const releaseManufacturingOrder = execute(async (req, res) =>
  sendSuccess(res, {
    data: await releaseProductionOrder(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Production Order released and raw materials consumed',
  }));

export const createBoardDraw = execute(async (req, res) =>
  sendSuccess(res, {
    data: await drawBoard(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Board draw recorded as WIP',
  }));

export const advanceBoardStage = execute(async (req, res) =>
  sendSuccess(res, {
    data: await advanceBoardLot(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Board process stage updated',
  }));

export const recordBoardInspection = execute(async (req, res) =>
  sendSuccess(res, {
    data: await inspectBoardLot(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Board inspection posted',
  }));

export const packBoard = execute(async (req, res) =>
  sendSuccess(res, {
    data: await packBoardLot(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Board packed and released to available stock',
  }));

export const createChoppingBatch = execute(async (req, res) =>
  sendCreated(res, {
    data: await processChopping(
      companyIdFromRequest(req),
      actorIdFromRequest(req),
      requestInput(req),
    ),
    message: 'Chopping batch posted with complete input/output genealogy',
  }));
