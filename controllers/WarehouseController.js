// controllers/WarehouseController.js
import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';

// --- helpers ---
const isValidId = (id) => mongoose.isValidObjectId(id);
const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const sanitize = (v) => (typeof v === 'string' ? v.trim() : v);
const pickPayload = (body = {}) => {
  const payload = {};
  if (body.code != null) payload.code = sanitize(body.code);
  if (body.name != null) payload.name = sanitize(body.name);
  if (body.address != null) payload.address = sanitize(body.address);
  if (body.pincode != null) payload.pincode = sanitize(body.pincode);
  if (body.state != null) payload.state = sanitize(body.state);
  return payload;
};

// --- Create ---
export const createWarehouse = async (req, res) => {
  try {
    const payload = pickPayload(req.body);
    if (!payload.code || !payload.name) {
      return res.status(400).json({ success: false, message: 'code and name are required' });
    }
    const doc = await Warehouse.create(payload);
    return res.json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate code. Warehouse code must be unique.' });
    }
    return res.status(500).json({ success: false, message: err?.message || 'Failed to create warehouse' });
  }
};

// --- Read: list (with basic search/pagination/sort) ---
export const listWarehouses = async (req, res) => {
  try {
    const { q, page, limit, sort = '-createdAt' } = req.query;
    const pageNum = toInt(page, 1);
    const limitNum = Math.min(toInt(limit, 20), 100);

    const filter = {};
    if (q && String(q).trim()) {
      const rx = new RegExp(String(q).trim(), 'i');
      filter.$or = [{ code: rx }, { name: rx }, { state: rx }, { address: rx }];
    }

    const [items, total] = await Promise.all([
      Warehouse.find(filter)
        .sort(sort)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Warehouse.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: items,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch warehouses' });
  }
};

// --- Read: single ---
export const getWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const doc = await Warehouse.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Warehouse not found' });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch warehouse' });
  }
};

// --- Update ---
export const updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const payload = pickPayload(req.body);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const updated = await Warehouse.findByIdAndUpdate(
      id,
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Warehouse not found' });
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate code. Warehouse code must be unique.' });
    }
    return res.status(500).json({ success: false, message: err?.message || 'Failed to update warehouse' });
  }
};

// --- Delete (hard delete). If you prefer soft delete, we can add a flag ---
export const deleteWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const deleted = await Warehouse.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Warehouse not found' });
    return res.json({ success: true, data: deleted });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Failed to delete warehouse' });
  }
};

// Optional: default export group
export default {
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  deleteWarehouse,
};