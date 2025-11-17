import mongoose from 'mongoose';
import Batch from '../models/Batches.js';
import RawMaterial from '../models/Rawmaterial.js';
import Campaign from '../models/Campaign.js';
import { handleError } from '../utils/errorHandler.js';

// Standardized HTTP error response helper
const sendHttpError = (res, err) => {
  const status = Number(err?.status) || 400;
  const payload = {
    success: false,
    message: String(err?.message || 'Request failed'),
  };
  // Include field errors if present (keeps existing shape you used elsewhere)
  if (err?.errors && typeof err.errors === 'object') {
    payload.errors = err.errors;
  }
  return res.status(status).json(payload);
};

/**
 * Normalize incoming request body to match Batch schema
 * - maps rawMaterials[].name -> rawMaterials[].rawMaterial (ObjectId string)
 * - coerces weights to numbers and removes invalid entries
 * - ensures date exists
 */
const normalizeBatchInput = (body = {}) => {
  const out = {};
  if (body.batche_id) out.batche_id = String(body.batche_id).trim();
  out.date = body.date ? new Date(body.date) : new Date();
  if (body.numbersBatches !== undefined) {
    const nb = Number(body.numbersBatches);
    out.numbersBatches = Number.isFinite(nb) && nb > 0 ? nb : 1;
  }
  if (Array.isArray(body.rawMaterials)) {
    out.rawMaterials = body.rawMaterials
      .map((rm) => {
        const id = rm?.rawMaterial_id  // accept either shape
        // const name = rm?.rawMaterialName // accept either shape
        const weightNum = Number(rm?.weight);
        if (!id || !Number.isFinite(weightNum) || weightNum < 0) return null;
        return {
          rawMaterial_id: id,
          // rawMaterialName: name,
          weight: weightNum,
          unit: rm?.unit || 'kg',
        };
      })
      .filter(Boolean);
  }
  if (body.createdBy) out.createdBy = body.createdBy;
    // campaign support
  if (body.campaign !== undefined) {
    if (!mongoose.isValidObjectId(body.campaign)) {
      const err = new Error('Invalid campaign id');
      err.status = 400;
      throw err;
    }
    out.campaign = body.campaign;
  }
  return out;
};

/** Ensure no duplicate rawMaterial ids in the array */
const assertNoDuplicateMaterials = (rawMaterials = []) => {
  const seen = new Set();
  for (const rm of rawMaterials) {
    const key = String(rm.rawMaterial_id);
    if (seen.has(key)) {
      const err = new Error('Duplicate rawMaterial found in rawMaterials array');
      err.status = 400;
      throw err;
    }
    seen.add(key);
  }
};

/** Ensure total weight > 0 */
const assertPositiveTotalWeight = (rawMaterials = []) => {
  const total = rawMaterials.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  if (total <= 0) {
    const err = new Error('Total weight of rawMaterials must be greater than 0');
    err.status = 400;
    throw err;
  }
};

// --- UOM helpers ---
// --- Campaign totals helpers ---
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;


// Compute totals for a campaign by scanning its batches
const computeCampaignTotals = async (campaignId, session) => {
  if (!campaignId) return { totalRawIssued: 0 };
  const batches = await Batch.find({ campaign: campaignId })
    .select('numbersBatches rawMaterials')
    .lean()
    .session(session || null);

  let totalRawIssuedG = 0; // grams

  for (const b of batches) {
    const multiplier = Number.isFinite(b?.numbersBatches) && b.numbersBatches > 0 ? b.numbersBatches : 1;
    if (Array.isArray(b?.rawMaterials)) {
      for (const rm of b.rawMaterials) {
        const grams = toGrams(rm?.weight, rm?.unit || 'kg');
        if (Number.isFinite(grams) && grams > 0) {
          totalRawIssuedG += grams * multiplier;
        }
      }
    }
  }

  return {
    totalRawIssued: round2(totalRawIssuedG / 1000),
  };
};

const updateCampaignTotals = async (campaignId, session) => {
  if (!campaignId) return;
  const totals = await computeCampaignTotals(campaignId, session);
  await Campaign.findByIdAndUpdate(
    campaignId,
    { $set: { totalRawIssued: totals.totalRawIssued } },
    { new: false }
  )
    .session(session || null);
};
const UOM_FACTORS_G = {
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

const toGrams = (value, unit = 'g') => {
  const v = Number(value);
  const factor = UOM_FACTORS_G[String(unit || '').toLowerCase()];
  if (!Number.isFinite(v) || !factor) return NaN;
  return v * factor;
};

/**
 * Ensure that for each rawMaterial, available stock (by its own UOM) >= required quantity in request.
 * Assumes RawMaterial docs have fields: `_id`, `stock` (Number), `uom` (String), and optional `name`.
 */
const assertSufficientInventory = async (rawMaterials = [], multiplier = 1) => {
  if (!Array.isArray(rawMaterials) || rawMaterials.length === 0) return;

  // Sum required per material in grams
  const requiredG = new Map(); // id -> grams
  for (const rm of rawMaterials) {
    const id = rm?.rawMaterial || rm?.rawMaterial_id;
    const grams = toGrams(rm?.weight, rm?.unit || 'kg');
    if (!id || !Number.isFinite(grams) || grams <= 0) continue;
    const need = grams * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
    requiredG.set(String(id), (requiredG.get(String(id)) || 0) + need);
  }
  if (requiredG.size === 0) return;
  // Fetch stocks
  const ids = Array.from(requiredG.keys());
  const docs = await RawMaterial.find({ _id: { $in: ids } }, 'productName currentStock UOM').lean();
  const byId = new Map(docs.map(d => [String(d._id), d]));
  // Compare
  for (const [id, needG] of requiredG.entries()) {
    const doc = byId.get(id);
    if (!doc) {
      const err = new Error(`Raw material not found: ${id}`);
      err.status = 400;
      throw err;
    }
    const haveG = toGrams(doc.currentStock ?? 0, doc.UOM || 'kg');
    if (!Number.isFinite(haveG)) {
      const err = new Error(`Invalid stock/UOM for raw material: ${doc.productName || id}`);
      err.status = 400;
      throw err;
    }
    if (haveG < needG) {
      // Build a friendly message showing both in material's native UOM
      const unitFactor = UOM_FACTORS_G[String(doc.UOM || 'kg').toLowerCase()] || 1;
      const needInDocUom = needG / unitFactor;
      const haveInDocUom = doc.currentStock ?? 0;
      const uomLabel = String(doc.UOM || 'kg');
      const err = new Error(`${doc.productName || id}: required ${needInDocUom} ${uomLabel}, available ${haveInDocUom} ${uomLabel}`);
      err.status = 400;
      throw err;
    }
  }
};

// Build a map of required grams per raw material id, with multiplier
const buildRequiredGramMap = (rawMaterials = [], multiplier = 1) => {
  const req = new Map();
  const m = (Number.isFinite(multiplier) && multiplier > 0) ? multiplier : 1;
  for (const rm of rawMaterials) {
    const id = rm?.rawMaterial || rm?.rawMaterial_id;
    const grams = toGrams(rm?.weight, rm?.unit || 'kg');
    if (!id || !Number.isFinite(grams) || grams <= 0) continue;
    req.set(String(id), (req.get(String(id)) || 0) + grams * m);
  }
  return req;
};

// Deduct inventory atomically using a session; guards against going negative
const deductInventory = async (rawMaterials = [], multiplier = 1, session) => {
  const requiredG = buildRequiredGramMap(rawMaterials, multiplier);
  if (requiredG.size === 0) return;
  const ids = Array.from(requiredG.keys());
  const docs = await RawMaterial.find(
    { _id: { $in: ids } },
    'productName currentStock UOM'
  ).session(session || null).lean();
  const byId = new Map(docs.map(d => [String(d._id), d]));

  const ops = [];
  for (const [id, needG] of requiredG.entries()) {
    const doc = byId.get(id);
    if (!doc) {
      const err = new Error(`Raw material not found during deduction: ${id}`);
      err.status = 400;
      throw err;
    }
    const unitFactor = UOM_FACTORS_G[String(doc.UOM || 'kg').toLowerCase()] || 1;
    const needInDocUom = needG / unitFactor;

    // Guard against concurrent negatives: only update if stock >= need
    ops.push({
      updateOne: {
        filter: { _id: id, currentStock: { $gte: needInDocUom } },
        update: { $inc: { currentStock: -needInDocUom } },
      }
    });
  }

  if (ops.length) {
    const res = await RawMaterial.bulkWrite(ops, { session: session || null });
    // Ensure all matched
    const matched = res.matchedCount || Object.values(res.result || {}).reduce((a, b) => a + (b?.matchedCount || 0), 0);
    if (matched !== ops.length) {
      const err = new Error('Insufficient stock due to concurrent changes');
      err.status = 409;
      throw err;
    }
  }
};

// CREATE
export const createBatch = async (req, res, next) => {
  try {
    const data = normalizeBatchInput(req.body);
    // // console.log('createBatch data', req.body); // here campaign is there and value is id of campaign
    if (!data.batche_id) {
      const err = new Error('batche_id is required');
      err.status = 400;
      throw err;
    }
    if (data.numbersBatches === undefined) {
      const err = new Error('numbersBatches is required');
      err.status = 400;
      throw err;
    }

    assertNoDuplicateMaterials(data.rawMaterials);
    assertPositiveTotalWeight(data.rawMaterials);
    await assertSufficientInventory(data.rawMaterials, data.numbersBatches);
    // // console.log("batch 1 data ",data); // but here campaign is not there it's removed why is this i need to update this because i have campaign in batch schema as below
    let populated;
    // return;
    try {
      // Try transactional path first (requires replica set or mongos)
      const session = await mongoose.startSession();
      await session.withTransaction(async () => {
        // Create the batch inside txn
        const [created] = await Batch.create([data], { session });
        // Deduct stock; if this fails, txn aborts and created batch rolls back
        await deductInventory(data.rawMaterials, data.numbersBatches, session);
        // Populate for response
        populated = await Batch.findById(created._id)
          .populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' })
          .session(session);
        if (created?.campaign) {
          await updateCampaignTotals(created.campaign, session);
        }
      });
      session.endSession();
      return res.status(201).json({ success: true, data: populated });
    } catch (txErr) {
      const msg = String(txErr?.message || '');
      // console.log('msg batches controller file ?', msg);
      const noTxnEnv = msg.includes('Transaction numbers are only allowed on a replica set member or mongos');
      if (!noTxnEnv) throw txErr; // different error → bubble up

      // console.log("batch data ",data);
      // Fallback path for standalone MongoDB (no transactions):
      // 1) Create the batch
      const created = await Batch.create(data);
      try {
        // 2) Attempt stock deduction with atomic guards
        await deductInventory(data.rawMaterials, data.numbersBatches, null);
      } catch (deductErr) {
        // 3) Compensate: delete the created batch if deduction failed
        await Batch.findByIdAndDelete(created._id).catch(() => { });
        throw deductErr;
      }
      // 4) Return populated batch
      const populatedFallback = await Batch.findById(created._id)
        .populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' });
      if (created?.campaign) {
        await updateCampaignTotals(created.campaign, null);
      }
      return res.status(201).json({ success: true, data: populatedFallback });
    }
  } catch (err) {
    if (err?.code === 11000) {
      err.status = 409; // duplicate key (batche_id)
      err.message = 'Batch with this batche_id already exists';
    }
    return sendHttpError(res, err);
  }
};

// LIST with pagination & filters
export const listBatches = async (req, res, next) => {
  try {
    const {campaign} = req.query;
    const filter = {};
    if (campaign !== undefined) {
      if (!mongoose.isValidObjectId(campaign)) {
        const err = new Error('Invalid campaign id');
        err.status = 400;
        throw err;
      }
      filter.campaign = campaign;
    }

    const [items, total] = await Promise.all([
      Batch.find(filter)
        .populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' }),
      Batch.countDocuments(filter),
    ]);

    // console.log(items[0]);
    res.json(items);
  } catch (err) {
    return sendHttpError(res, err);
  }
};

// READ by id
export const getBatchById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid batch id');
      err.status = 400;
      throw err;
    }
    const doc = await Batch.findById(id).populate({
      path: 'rawMaterials.rawMaterial_id',
      select: 'productName UOM',
    });
    if (!doc) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }
    res.json(doc);
  } catch (err) {
    return sendHttpError(res, err);
  }
};

// UPDATE (full or partial)
export const updateBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid batch id');
      err.status = 400;
      throw err;
    }
    const existing = await Batch.findById(id).select('campaign numbersBatches');
    if (!existing) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }
    const prevCampaignId = existing.campaign ? String(existing.campaign) : null;

    const updates = normalizeBatchInput(req.body);

    if (updates.rawMaterials) {
      assertNoDuplicateMaterials(updates.rawMaterials);
      assertPositiveTotalWeight(updates.rawMaterials);
      // Use the updated numbersBatches if provided, otherwise read the current one from DB
      let multiplier = updates.numbersBatches;
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        const current = await Batch.findById(id).select('numbersBatches').lean();
        multiplier = current?.numbersBatches || 1;
      }
      await assertSufficientInventory(updates.rawMaterials, multiplier);
    }

    const doc = await Batch.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' });

    if (!doc) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }

    // Recompute totals for affected campaigns (previous and new if changed)
    const newCampaignId = doc?.campaign ? String(doc.campaign) : null;
    const toUpdate = new Set([prevCampaignId, newCampaignId].filter(Boolean));
    for (const cid of toUpdate) {
      await updateCampaignTotals(cid, null);
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      err.status = 409; // duplicate key
      err.message = 'Another batch already uses this batche_id';
    }
    return sendHttpError(res, err);
  }
};

// DELETE
export const deleteBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid batch id');
      err.status = 400;
      throw err;
    }
    const doc = await Batch.findByIdAndDelete(id);
    if (!doc) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }
    if (doc?.campaign) {
      await updateCampaignTotals(doc.campaign, null);
    }
    res.json({ success: true, message: 'Batch deleted' });
  } catch (err) {
    return sendHttpError(res, err);
  }
};

// Append a raw material to a batch
export const addRawMaterial = async (req, res, next) => {
  try {
    const { id } = req.params; // batch id
    const { rawMaterial, name, weight, unit } = req.body;
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid batch id');
      err.status = 400;
      throw err;
    }
    const rmId = rawMaterial || name;
    const w = Number(weight);
    if (!rmId || !Number.isFinite(w) || w <= 0) {
      const err = new Error('rawMaterial (or name) and positive weight are required');
      err.status = 400;
      throw err;
    }

    const batch = await Batch.findById(id);
    if (!batch) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }

    // Prevent duplicates
    if (batch.rawMaterials.some((r) => String(r.rawMaterial_id) === String(rmId))) {
      const err = new Error('rawMaterial already exists in this batch');
      err.status = 400;
      throw err;
    }

    batch.rawMaterials.push({ rawMaterial_id: rmId, weight: w, unit: unit || 'kg' });
    await batch.save();

    const populated = await batch.populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' });
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    return sendHttpError(res, err);
  }
};

// Remove a raw material from a batch
export const removeRawMaterial = async (req, res, next) => {
  try {
    const { id, rmId } = req.params; // batch id, raw material id in subdoc
    if (!mongoose.isValidObjectId(id)) {
      const err = new Error('Invalid batch id');
      err.status = 400;
      throw err;
    }

    const batch = await Batch.findById(id);
    if (!batch) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }

    const before = batch.rawMaterials.length;
    batch.rawMaterials = batch.rawMaterials.filter((r) => String(r.rawMaterial_id) !== String(rmId));
    if (batch.rawMaterials.length === before) {
      const err = new Error('rawMaterial not present in this batch');
      err.status = 404;
      throw err;
    }

    await batch.save();
    const populated = await batch.populate({ path: 'rawMaterials.rawMaterial_id', select: 'productName UOM' });
    res.json({ success: true, data: populated });
  } catch (err) {
    return sendHttpError(res, err);
  }
};

export default {
  createBatch,
  listBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
  addRawMaterial,
  removeRawMaterial,
};