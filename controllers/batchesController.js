import mongoose from 'mongoose';
import Batch from '../models/Batches.js';
import Campaign from '../models/Campaign.js';
import Item from '../models/Item.js';
import Warehouse from '../models/Warehouse.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import {
  issue as issueInventory,
  receive as receiveInventory,
} from '../services/inventoryService.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const MASS_TO_GRAMS = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  tonne: 1000000,
  ton: 1000000,
  t: 1000000,
};

const BATCH_POPULATE = [
  {
    path: 'rawMaterials.itemId',
    select: 'name sku grade UOM categoryKey status',
  },
  {
    path: 'warehouseId',
    select: 'code name',
  },
];

const httpError = (message, status = 400) => {
  return new AppError(message, {
    statusCode: status,
    code: status === 404 ? 'BATCH_NOT_FOUND' : 'BATCH_REQUEST_INVALID',
  });
};

const handleBatchError = (req, res, error) => {
  if (error?.code === 11000) {
    return handleError(res, new AppError('A batch with this Batch ID already exists.', {
      statusCode: 409,
      code: 'DUPLICATE_BATCH_ID',
      details: error.keyValue || null,
    }), req);
  }

  return handleError(res, error, req);
};

const normalizeUnit = (unit) => String(unit || '').trim().toLowerCase();

const convertQuantity = (quantity, fromUnit, toUnit) => {
  const value = Number(quantity);
  if (!Number.isFinite(value) || value <= 0) {
    throw httpError('Material quantity must be greater than 0');
  }

  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) throw httpError('Material UOM is required');
  if (from === to) return value;

  const fromFactor = MASS_TO_GRAMS[from];
  const toFactor = MASS_TO_GRAMS[to];
  if (!fromFactor || !toFactor) {
    throw httpError(`Cannot convert material quantity from ${fromUnit} to ${toUnit}`);
  }

  return (value * fromFactor) / toFactor;
};

const toKg = (quantity, unit) => {
  const factor = MASS_TO_GRAMS[normalizeUnit(unit)];
  if (!factor) return 0;
  return (Number(quantity) * factor) / 1000;
};

const validateObjectId = (value, field) => {
  if (!mongoose.isValidObjectId(value)) {
    throw httpError(`${field} is invalid`);
  }
};

const normalizeMaterialInput = (line) => {
  const itemId = line?.itemId;
  const weight = Number(line?.weight);
  const unit = String(line?.unit || 'kg').trim();

  if (!itemId) throw httpError('Every material line requires itemId');
  validateObjectId(itemId, 'Material itemId');
  if (!Number.isFinite(weight) || weight <= 0) {
    throw httpError('Every material line requires a positive weight');
  }
  if (!unit) throw httpError('Every material line requires a unit');

  return { itemId, weight, unit };
};

const normalizeCreateInput = (body = {}) => {
  const batcheId = String(body.batche_id || '').trim();
  const numbersBatches = Number(body.numbersBatches);
  const date = body.date ? new Date(body.date) : new Date();
  const campaign = body.campaign;
  const warehouseId = body.warehouseId;

  if (!batcheId) throw httpError('batche_id is required');
  if (!Number.isInteger(numbersBatches) || numbersBatches <= 0) {
    throw httpError('numbersBatches must be a positive whole number');
  }
  if (Number.isNaN(date.getTime())) throw httpError('date is invalid');
  validateObjectId(campaign, 'campaign');
  validateObjectId(warehouseId, 'warehouseId');

  if (!Array.isArray(body.rawMaterials) || body.rawMaterials.length === 0) {
    throw httpError('At least one raw material is required');
  }

  const rawMaterials = body.rawMaterials.map(normalizeMaterialInput);
  const seen = new Set();
  for (const line of rawMaterials) {
    const key = String(line.itemId);
    if (seen.has(key)) throw httpError('A raw material can only be added once');
    seen.add(key);
  }

  return {
    batche_id: batcheId,
    date,
    numbersBatches,
    campaign,
    warehouseId,
    rawMaterials,
  };
};

const loadMaterialItems = async (lines, companyId, session) => {
  const ids = lines.map((line) => line.itemId);
  const query = Item.find({
    _id: { $in: ids },
    companyId,
  })
    .select('_id companyId name categoryKey UOM status')
    .lean();
  if (session) query.session(session);
  const items = await query;
  const byId = new Map(items.map((item) => [String(item._id), item]));

  return lines.map((line) => {
    const item = byId.get(String(line.itemId));
    if (!item) throw httpError(`Raw-material item not found: ${line.itemId}`, 404);
    if (item.categoryKey !== 'RAW') {
      throw httpError(`${item.name} is not a RAW item`);
    }
    if (item.status !== 'active') {
      throw httpError(`${item.name} must be active before it can be consumed`);
    }
    if (!item.UOM) throw httpError(`${item.name} does not have a UOM`);

    return { line, item };
  });
};

const prepareIssuedLines = async (
  lines,
  numbersBatches,
  companyId,
  session
) => {
  const resolved = await loadMaterialItems(lines, companyId, session);

  return resolved.map(({ line, item }) => ({
    itemId: item._id,
    weight: line.weight,
    unit: line.unit,
    issuedQuantity: convertQuantity(
      line.weight * numbersBatches,
      line.unit,
      item.UOM
    ),
    issuedUom: item.UOM,
    itemName: item.name,
  }));
};

const postMaterialIssues = async ({
  lines,
  companyId,
  warehouseId,
  userId,
  batchId,
  batchCode,
  session,
}) => {
  for (const line of lines) {
    const buckets = await InventorySnapshot.find({
      companyId,
      itemId: line.itemId,
      warehouseId,
      uom: normalizeUnit(line.issuedUom),
      available: { $gt: 0 },
    })
      .select('_id available bin batchNo uom createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .session(session)
      .lean();

    let remaining = line.issuedQuantity;
    const allocations = [];
    for (const bucket of buckets) {
      if (remaining <= 1e-9) break;
      const quantity = Math.min(remaining, Number(bucket.available || 0));
      if (quantity <= 1e-9) continue;

      const movement = await issueInventory({
        companyId,
        itemId: line.itemId,
        warehouseId,
        uom: line.issuedUom,
        qty: quantity,
        by: userId,
        note: `Raw material issued for manufacturing batch ${batchCode}`,
        refType: 'MANUFACTURING_BATCH',
        refId: String(batchId),
        bin: bucket.bin,
        batchNo: bucket.batchNo,
        session,
      });
      allocations.push({
        quantity,
        uom: movement.ledger.uom,
        bin: bucket.bin || null,
        batchNo: bucket.batchNo || null,
        snapshotId: movement.snapshot?._id || bucket._id,
        ledgerId: movement.ledger?._id || null,
      });
      remaining -= quantity;
    }

    if (remaining > 1e-9) {
      throw httpError(
        `Insufficient available stock for ${line.itemName}: `
        + `${line.issuedQuantity - remaining} of ${line.issuedQuantity} ${line.issuedUom} available`,
        409,
      );
    }
    line.inventoryAllocations = allocations;
  }
  return lines;
};

const reverseMaterialIssues = async ({
  lines,
  companyId,
  warehouseId,
  userId,
  batchId,
  batchCode,
  session,
  reason,
}) => {
  for (const line of lines) {
    const allocations = line.inventoryAllocations?.length
      ? line.inventoryAllocations
      : [{
          quantity: line.issuedQuantity,
          uom: line.issuedUom,
          bin: null,
          batchNo: null,
        }];
    for (const allocation of allocations) {
      await receiveInventory({
        companyId,
        itemId: line.itemId,
        warehouseId,
        uom: allocation.uom || line.issuedUom,
        qty: allocation.quantity,
        by: userId,
        note: reason || `Raw material returned from manufacturing batch ${batchCode}`,
        refType: 'MANUFACTURING_BATCH_REVERSAL',
        refId: String(batchId),
        bin: allocation.bin || null,
        batchNo: allocation.batchNo || null,
        allowInactiveItem: true,
        allowInactiveWarehouse: true,
        session,
      });
    }
  }
};

const computeCampaignTotals = async (campaignId, session) => {
  const query = Batch.find({ campaign: campaignId })
    .select('numbersBatches rawMaterials.weight rawMaterials.unit')
    .lean();
  if (session) query.session(session);
  const batches = await query;

  const totalRawIssued = batches.reduce((batchTotal, batch) => {
    const multiplier = Number(batch.numbersBatches) || 0;
    const lineTotal = (batch.rawMaterials || []).reduce(
      (sum, line) => sum + toKg(line.weight, line.unit) * multiplier,
      0
    );
    return batchTotal + lineTotal;
  }, 0);

  return Math.round(totalRawIssued * 1000) / 1000;
};

const updateCampaignTotal = async (campaignId, session) => {
  if (!campaignId) return;
  const totalRawIssued = await computeCampaignTotals(campaignId, session);
  const query = Campaign.updateOne(
    { _id: campaignId },
    { $set: { totalRawIssued } }
  );
  if (session) query.session(session);
  await query;
};

const ensureBatchScope = (batch, companyId) => {
  if (!batch) throw httpError('Batch not found', 404);
  if (String(batch.companyId) !== String(companyId)) {
    throw httpError('Batch not found', 404);
  }
};

export const createBatch = async (req, res) => {
  let session;
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId || req.user?.id;
    if (!companyId) throw httpError('Missing companyId on user', 401);

    const input = normalizeCreateInput(req.body);
    const [campaign, warehouse] = await Promise.all([
      Campaign.findById(input.campaign).select('_id').lean(),
      Warehouse.findOne({
        _id: input.warehouseId,
        companyId,
        status: 'active',
      }).select('_id').lean(),
    ]);
    if (!campaign) throw httpError('Campaign not found', 404);
    if (!warehouse) throw httpError('Warehouse not found', 404);

    session = await mongoose.startSession();
    let createdId;

    await session.withTransaction(async () => {
      const issuedLines = await prepareIssuedLines(
        input.rawMaterials,
        input.numbersBatches,
        companyId,
        session
      );

      const [created] = await Batch.create(
        [{
          ...input,
          companyId,
          createdBy: userId,
          rawMaterials: issuedLines.map(({ itemName, ...line }) => line),
        }],
        { session }
      );
      createdId = created._id;

      const allocatedLines = await postMaterialIssues({
        lines: issuedLines,
        companyId,
        warehouseId: input.warehouseId,
        userId,
        batchId: created._id,
        batchCode: input.batche_id,
        session,
      });
      created.rawMaterials = allocatedLines.map(({ itemName, ...line }) => line);
      await created.save({ session });
      await updateCampaignTotal(input.campaign, session);
    });

    const created = await Batch.findById(createdId).populate(BATCH_POPULATE);
    return res.status(201).json({
      success: true,
      message: 'Batch created and raw materials issued',
      data: created,
    });
  } catch (error) {
    return handleBatchError(req, res, error);
  } finally {
    if (session) await session.endSession();
  }
};

export const listBatches = async (req, res) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) throw httpError('Missing companyId on user', 401);

    const filter = { companyId };
    if (req.query.campaign !== undefined) {
      validateObjectId(req.query.campaign, 'campaign');
      filter.campaign = req.query.campaign;
    }

    const batches = await Batch.find(filter)
      .populate(BATCH_POPULATE)
      .sort({ date: -1, createdAt: -1 });
    return res.json(batches);
  } catch (error) {
    return handleBatchError(req, res, error);
  }
};

export const getBatchById = async (req, res) => {
  try {
    validateObjectId(req.params.id, 'batch id');
    const batch = await Batch.findById(req.params.id).populate(BATCH_POPULATE);
    ensureBatchScope(batch, req.user?.companyId);
    return res.json(batch);
  } catch (error) {
    return handleBatchError(req, res, error);
  }
};

export const updateBatch = async (req, res) => {
  try {
    validateObjectId(req.params.id, 'batch id');
    const batch = await Batch.findById(req.params.id);
    ensureBatchScope(batch, req.user?.companyId);

    const inventoryFields = ['rawMaterials', 'numbersBatches', 'warehouseId'];
    if (inventoryFields.some((field) => req.body?.[field] !== undefined)) {
      throw httpError(
        'Issued material quantities cannot be edited directly. Reverse the batch or use the material add/remove actions.',
        409
      );
    }

    if (req.body?.batche_id !== undefined) {
      const value = String(req.body.batche_id).trim();
      if (!value) throw httpError('batche_id cannot be empty');
      batch.batche_id = value;
    }
    if (req.body?.date !== undefined) {
      const date = new Date(req.body.date);
      if (Number.isNaN(date.getTime())) throw httpError('date is invalid');
      batch.date = date;
    }

    const previousCampaign = String(batch.campaign);
    if (req.body?.campaign !== undefined) {
      validateObjectId(req.body.campaign, 'campaign');
      const campaign = await Campaign.findById(req.body.campaign).select('_id').lean();
      if (!campaign) throw httpError('Campaign not found', 404);
      batch.campaign = req.body.campaign;
    }

    await batch.save();
    await updateCampaignTotal(previousCampaign);
    if (String(batch.campaign) !== previousCampaign) {
      await updateCampaignTotal(batch.campaign);
    }

    await batch.populate(BATCH_POPULATE);
    return res.json({ success: true, data: batch });
  } catch (error) {
    return handleBatchError(req, res, error);
  }
};

export const deleteBatch = async (req, res) => {
  let session;
  try {
    validateObjectId(req.params.id, 'batch id');
    const companyId = req.user?.companyId;
    const userId = req.user?.userId || req.user?.id;
    const batch = await Batch.findById(req.params.id);
    ensureBatchScope(batch, companyId);

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await reverseMaterialIssues({
        lines: batch.rawMaterials,
        companyId,
        warehouseId: batch.warehouseId,
        userId,
        batchId: batch._id,
        batchCode: batch.batche_id,
        session,
        reason: `Raw material returned because manufacturing batch ${batch.batche_id} was deleted`,
      });
      await Batch.deleteOne({ _id: batch._id }).session(session);
      await updateCampaignTotal(batch.campaign, session);
    });

    return res.json({
      success: true,
      message: 'Batch deleted and issued materials returned to inventory',
    });
  } catch (error) {
    return handleBatchError(req, res, error);
  } finally {
    if (session) await session.endSession();
  }
};

export const addBatchMaterial = async (req, res) => {
  let session;
  try {
    validateObjectId(req.params.id, 'batch id');
    const companyId = req.user?.companyId;
    const userId = req.user?.userId || req.user?.id;
    const batch = await Batch.findById(req.params.id);
    ensureBatchScope(batch, companyId);

    const input = normalizeMaterialInput(req.body);
    if (batch.rawMaterials.some((line) => String(line.itemId) === String(input.itemId))) {
      throw httpError('This raw material is already in the batch');
    }

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const [issuedLine] = await prepareIssuedLines(
        [input],
        batch.numbersBatches,
        companyId,
        session
      );
      const [allocatedLine] = await postMaterialIssues({
        lines: [issuedLine],
        companyId,
        warehouseId: batch.warehouseId,
        userId,
        batchId: batch._id,
        batchCode: batch.batche_id,
        session,
      });
      batch.rawMaterials.push(allocatedLine);
      await batch.save({ session });
      await updateCampaignTotal(batch.campaign, session);
    });

    await batch.populate(BATCH_POPULATE);
    return res.status(201).json({ success: true, data: batch });
  } catch (error) {
    return handleBatchError(req, res, error);
  } finally {
    if (session) await session.endSession();
  }
};

export const removeBatchMaterial = async (req, res) => {
  let session;
  try {
    validateObjectId(req.params.id, 'batch id');
    const companyId = req.user?.companyId;
    const userId = req.user?.userId || req.user?.id;
    const batch = await Batch.findById(req.params.id);
    ensureBatchScope(batch, companyId);

    const line = batch.rawMaterials.find(
      (entry) =>
        String(entry._id) === String(req.params.materialId) ||
        String(entry.itemId) === String(req.params.materialId)
    );
    if (!line) throw httpError('Raw material is not present in this batch', 404);
    if (batch.rawMaterials.length === 1) {
      throw httpError('A batch must contain at least one raw material', 409);
    }

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await reverseMaterialIssues({
        lines: [line],
        companyId,
        warehouseId: batch.warehouseId,
        userId,
        batchId: batch._id,
        batchCode: batch.batche_id,
        session,
        reason: `Raw material removed from manufacturing batch ${batch.batche_id}`,
      });
      batch.rawMaterials.pull(line._id);
      await batch.save({ session });
      await updateCampaignTotal(batch.campaign, session);
    });

    await batch.populate(BATCH_POPULATE);
    return res.json({ success: true, data: batch });
  } catch (error) {
    return handleBatchError(req, res, error);
  } finally {
    if (session) await session.endSession();
  }
};

export default {
  createBatch,
  listBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
  addBatchMaterial,
  removeBatchMaterial,
};
