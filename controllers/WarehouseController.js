import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';
import InventoryLedger from '../models/InventoryLedger.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import { AppError, handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';

const fail = (message, statusCode = 400, code = 'WAREHOUSE_ERROR') =>
  new AppError(message, { statusCode, code });

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function companyIdFromRequest(req) {
  const companyId = req.user?.companyId;
  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw fail('A valid company is required', 401, 'COMPANY_REQUIRED');
  }
  return companyId;
}

function validateId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw fail('Warehouse ID is invalid', 400, 'INVALID_ID');
  }
}

function pickPayload(body = {}) {
  const payload = {};
  for (const field of ['code', 'name', 'address', 'pincode', 'state']) {
    if (body[field] !== undefined) payload[field] = String(body[field] || '').trim();
  }
  if (payload.code !== undefined) payload.code = payload.code.toUpperCase();
  return payload;
}

export const createWarehouse = async (req, res) => {
  try {
    const payload = pickPayload(req.body);
    if (!payload.code || !payload.name) {
      throw fail('Warehouse code and name are required');
    }
    const warehouse = await Warehouse.create(applyAuditCreate(req, {
      ...payload,
      companyId: companyIdFromRequest(req),
      status: 'active',
    }));
    return res.status(201).json({
      success: true,
      message: 'Warehouse created',
      data: warehouse,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listWarehouses = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query?.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 20, 1), 100);
    const filter = { companyId: companyIdFromRequest(req) };
    const status = String(req.query?.status || 'active').trim().toLowerCase();
    if (status !== 'all') {
      if (!['active', 'archived'].includes(status)) throw fail('status is invalid');
      filter.status = status;
    }
    if (req.query?.q && String(req.query.q).trim()) {
      const regex = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
      filter.$or = [
        { code: regex },
        { name: regex },
        { state: regex },
        { address: regex },
      ];
    }

    const sort = ['name', '-name', 'code', '-code', 'createdAt', '-createdAt']
      .includes(req.query?.sort)
      ? req.query.sort
      : 'name';
    const [items, total] = await Promise.all([
      Warehouse.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Warehouse.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getWarehouse = async (req, res) => {
  try {
    validateId(req.params.id);
    const warehouse = await Warehouse.findOne({
      _id: req.params.id,
      companyId: companyIdFromRequest(req),
    });
    if (!warehouse) throw fail('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
    return res.json({ success: true, data: warehouse });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateWarehouse = async (req, res) => {
  try {
    validateId(req.params.id);
    const payload = pickPayload(req.body);
    if (!Object.keys(payload).length) throw fail('No valid fields to update');
    if (payload.code === '' || payload.name === '') {
      throw fail('Warehouse code and name cannot be empty');
    }

    const warehouse = await Warehouse.findOneAndUpdate(
      {
        _id: req.params.id,
        companyId: companyIdFromRequest(req),
        status: { $ne: 'archived' },
      },
      { $set: applyAuditUpdate(req, payload) },
      { new: true, runValidators: true },
    );
    if (!warehouse) {
      throw fail('Active Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');
    }
    return res.json({
      success: true,
      message: 'Warehouse updated',
      data: warehouse,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Warehouses are archived, never hard-deleted, because ledger rows must keep
 * their historical location reference.
 */
export const deleteWarehouse = async (req, res) => {
  try {
    validateId(req.params.id);
    const companyId = companyIdFromRequest(req);
    const warehouse = await Warehouse.findOne({ _id: req.params.id, companyId });
    if (!warehouse) throw fail('Warehouse not found', 404, 'WAREHOUSE_NOT_FOUND');

    const [ledgerCount, stockCount] = await Promise.all([
      InventoryLedger.countDocuments({ companyId, warehouseId: warehouse._id }),
      InventorySnapshot.countDocuments({
        companyId,
        warehouseId: warehouse._id,
        $or: [{ onHand: { $ne: 0 } }, { reserved: { $ne: 0 } }],
      }),
    ]);
    if (stockCount > 0) {
      throw fail(
        'Warehouse cannot be archived while it contains stock or reservations',
        409,
        'WAREHOUSE_HAS_STOCK',
      );
    }

    warehouse.status = 'archived';
    warehouse.updatedBy = req.user?.userId || req.user?.id || req.user?._id;
    await warehouse.save();
    return res.json({
      success: true,
      message: 'Warehouse archived',
      data: warehouse,
      ledgerCount,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export default {
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  deleteWarehouse,
};
