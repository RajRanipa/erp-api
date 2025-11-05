// backend-api/controllers/itemsController.js
import Item, { STATUS } from "../models/Item.js";
import Category from "../models/Category.js";
import ProductType from "../models/ProductType.js";
import Temperature from "../models/Temperature.js";
import Density from "../models/Density.js";
import Dimension from "../models/Dimension.js";
// import PackingMaterial from "../models/Packing.js";
import { handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';

export const createUser = async (req, res) => {
  try {
    const user = await User.create(req.body);
    return res.status(201).json({ status: true, status_code: 201, message: 'User created', data: user });
  } catch (error) {
    return handleError(res, error);
  }
};


// Helper: Validation based on category
function validateItemFields(data, categoryName) {
  // Common required fields
  if (!data.name || typeof data.name !== 'string' || !String(data.name).trim()) return 'Name is required.';
  if (!data.product_unit || typeof data.product_unit !== 'string' || !String(data.product_unit).trim()) return 'Product unit is required.';
  if (!data.category) return 'Category is required.';
  // productType is required for many FG items but optional for RAW depending on business rules

  // Normalize category name for comparisons
  const cat = (categoryName || '').toString().toLowerCase();
  const isFG = cat === 'fg' || cat === 'finished goods' || cat.includes('finish');

  if (isFG) {
    if (!data.productType) return 'Product type is required for finished goods.';
    if (!data.temperature) return 'Temperature is required for finished goods.';
    // accept either packing (frontend key) or packingType (backend key)
    if (!data.packing && !data.packingType) return 'Packing is required for finished goods.';
  }

  // RAW-specific checks (if you want to enforce):
  const isRaw = cat === 'raw' || cat === 'raw material' || cat.includes('raw');
  if (isRaw) {
    // temperature and density typical for raw materials
    // if (!data.temperature) return 'Temperature is required for raw materials.';
    // if (!data.density) return 'Density is required for raw materials.';
  }

  // PACKING-specific checks
  // const isPacking = cat === 'packing' || cat === 'packing material' || cat.includes('pack');
  // if (isPacking) {
  //   if (!data.dimension) return 'Dimension is required for packing materials.';
  // }

  return null;
}

function deriveCategoryKeyFromName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('raw')) return 'RAW';
  if (n.includes('finish') || n.includes('finished')) return 'FG';
  if (n.includes('pack')) return 'PACKING';
  return null;
}

export const createItem = async (req, res) => {
  try {


    const { sku, category } = req.body;
    const rest = { ...req.body };
    // Populate category to get name
    const cat = await Category.findById(category);
    console.log('rest', rest); //  packing is here 
    console.log('cat', cat); // but why it's not here
    // if (!cat) throw new AppError('Invalid category.', { statusCode: 400, code: 'INVALID_CATEGORY' });
    // Validate fields
    let payload = { ...rest, sku: rest.sku || sku || null, category };
    // ensure categoryKey present on payload for index/duplicate checks
    const derivedKey = deriveCategoryKeyFromName(cat.name);
    if (derivedKey) payload.categoryKey = derivedKey;
    // Apply audit fields from authenticated user (createdBy, updatedBy, companyId)
    payload =  applyAuditCreate(req, payload);
    const error = validateItemFields(payload, cat.name);
    console.log('error', error);
    if (error) {
      throw new Error(String(error));
    }
    // Check unique SKU (only if provided)
    console.log('payload.sku', payload);
    // Create
    const item = new Item(payload);
    console.log('item', item);
    await item.save();
    return res.status(201).json({ message: 'Item created', item });
  } catch (error) {
    return handleError(res, error);
  }
};

// Get Item by ID (with population)
export const getItemById = async (req, res) => {
  try {
    const { id } = req.query;
    console.log('getItemById id', id);
    const item = await Item.findById(
      id,
      'name product_unit minimumStock description category productType temperature density dimension packing brandType productColor grade status'
    )
      // .populate('category', 'name')
      // .populate('productType', 'name')
      // .populate('temperature', 'name value')
      // .populate('density', 'name value')
      // .populate('dimension', 'width length thickness unit')
      // .populate('packing', 'name brandType productColor')
      .lean();
    if (!item) return res.status(404).json({ error: 'Item not found' });
    console.log('item getItemById', item);
    return res.json(item);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get All Items (with filtering)
export const getAllItems = async (req, res) => {
  console.log('req.query in getAllItems', req.query);
  try {
    const { status, categoryKey, productType, temperature, density, dimension, packing } = req.query || {};
    const filter = {};

    // Filter by categoryKey if provided
    if (categoryKey) filter.categoryKey = categoryKey;
    if (productType) filter.productType = productType;
    if (temperature) filter.temperature = temperature;
    if (density) filter.density = density;
    if (dimension) filter.dimension = dimension;
    if (packing) filter.packing = packing;

    // Status filtering:
    // - If status=all -> no filter
    // - If status is provided as comma-separated -> IN query
    // - Else default to active
    if (typeof status === 'string') {
      if (status.toLowerCase() !== 'all') {
        const list = status.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length) filter.status = { $in: list };
      }
    } else {
      filter.status = STATUS.ACTIVE;
    }

    const items = await Item.find(filter)
    .populate('temperature', 'value unit')
    .populate('density', 'value unit')
    .populate('packing', 'name brandType productColor')
    .populate('dimension', 'width length thickness unit')
    .lean();

    // console.log('items in getAllItems (count)', items?.length || 0, 'items', items);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get All Items (with filtering)
export const getAllItemsOptions = async (req, res) => {
  console.log('req.query in getAllItems', req.query);
  try {
    const { status, categoryKey } = req.query || {};
    const filter = {};

    // Filter by categoryKey if provided
    if (categoryKey) filter.categoryKey = categoryKey;

    // Status filtering:
    // - If status=all -> no filter
    // - If status is provided as comma-separated -> IN query
    // - Else default to active
    if (typeof status === 'string') {
      if (status.toLowerCase() !== 'all') {
        const list = status.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length) filter.status = { $in: list };
      }
    } else {
      filter.status = STATUS.ACTIVE;
    }

    const items = await Item.find(filter).lean();
    // console.log('items in getAllItems (count)', items?.length || 0, 'items', items[0]);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// Update Item
export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findById(id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    // normalize incoming update payload
    const normalized = { ...req.body };
    // Stamp updatedBy from authenticated user
    const updateWithAudit = applyAuditUpdate(req, normalized);
    // If SKU is being updated, check uniqueness
    if (normalized.sku && normalized.sku !== item.sku) {
      const existing = await Item.findOne({ sku: normalized.sku });
      if (existing) return res.status(409).json({ error: 'SKU already exists.' });
    }
    // If category is being updated or present, get category name for validation
    let catName = null;
    if (normalized.category) {
      const cat = await Category.findById(normalized.category);
      if (!cat) return res.status(400).json({ error: 'Invalid category.' });
      catName = cat.name;
    } else {
      const cat = await Category.findById(item.category);
      catName = cat ? cat.name : null;
    }
    // Validate fields
    const error = validateItemFields({ ...item.toObject(), ...normalized }, catName);
    if (error) return res.status(400).json({ error });
    // Update
    Object.assign(item, updateWithAudit);
    await item.save();
    return res.json({ message: 'Item updated', item });
  } catch (error) {
    // console.log('err', error);
    return handleError(res, error);
  }
};

// Delete Item
export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findById(id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.status === STATUS.ARCHIVED) {
      // If already archived, allow hard delete (or you can block it based on policy)
      await Item.findByIdAndDelete(id);
      return res.json({ message: 'Item permanently deleted (was archived).' });
    }
    // Prefer archiving instead of immediate delete
    await item.setStatus(STATUS.ARCHIVED, {
      userId: req.user?._id,
      reason: 'Soft delete via delete endpoint',
      companyId: req.user?.companyId
    });
    return res.json({ message: 'Item archived (soft delete).', item });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};
// PATCH /items/:id/status
// body: { to: 'active', reason?: 'QC ok' }
export const updateItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, reason } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing target status "to".' });

    const item = await Item.findById(id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    await item.setStatus(to, {
      userId: req.user?._id,
      reason: reason || '',
      companyId: req.user?.companyId
    });

    // Optionally return latest history entry + item
    return res.json({ message: 'Status updated', item });
  } catch (error) {
    return handleError(res, error);
  }
};

// Fetch summary of items where categoryKey === 'PACKING' (only _id, name, brandType)
export const getPackingItems = async (req, res) => {
  try {
    console.log('getPackingItems');
    // Simple fixed query: only items with categoryKey PACKING
    const packings = await Item.find({ categoryKey: 'PACKING' })
      .populate('productType', 'name')
      .populate('dimension', 'width length thickness unit')
      .lean();
    // console.log('packings', packings[0]); // i need to give productType name or i need to populate name of productType
    return res.status(200).json(packings);

  } catch (error) {
    return handleError(res, error);
  }
};
export const getFinishedItems = async (req, res) => {
  try {
    console.log('getFinishedItems');
    // Simple fixed query: only items with categoryKey PACKING
    const FG = await Item.find({ categoryKey: 'FG' })
      .populate('productType', 'name')
      .populate('dimension', 'width length thickness unit')
      .populate('density', 'value unit')
      .populate('temperature', 'value unit')
      .populate('packing', 'name brandType productColor')
      .lean();

    // console.log('FG', mapFG[0]); // i need to give productType name or i need to populate name of productType
    return res.status(200).json(FG);

  } catch (error) {
    return handleError(res, error);
  }
};
export const getRawItems = async (req, res) => {
  try {
    console.log('getRawItems');
    // Simple fixed query: only items with categoryKey PACKING
    const packings = await Item.find({ categoryKey: 'RAW' }).lean();
    console.log('RAW', packings[0]);

    return res.status(200).json(packings);

  } catch (error) {
    return handleError(res, error);
  }
};

// Fetch summary of items where categoryKey === 'PACKING' (only _id, name, brandType)
export const getPackingItemsByid = async (req, res) => {
  try {
    const { productType } = req.query || {};
    console.log('productType', productType);
    if (!productType) {
      return res.status(400).json({ message: 'productType is a required query param' });
    }

    const isValidObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    if (!isValidObjectId(productType)) {
      return res.status(400).json({ message: 'Invalid productType id format' });
    }
    // Simple fixed query: only items with categoryKey PACKING
    const packings = await Item.find({ categoryKey: 'PACKING', productType }, '_id name brandType productColor').populate('dimension', 'width length thickness unit').lean();
    const mapped = valueandlabel(packings)

    console.log('packings by id', mapped[0]);
    return res.status(200).json(mapped);
  } catch (error) {
    return handleError(res, error);
  }
};

// You can wire this controller in your routes like:
// router.get('/items/packing', getPackingItems);

function valueandlabel(packings) {
  if (!Array.isArray(packings)) return [];
  const mapped = packings.map((p) => {
    const nameLine = `
    <p>
      ${mapPacking(p)}
    </p>
  `;
    const dimensionLine = `<span class="text-xs text-white-500">${mapDimension(p?.dimension) || ''}</span>`;

    return {
      value: String(p._id),
      label: `${nameLine}${dimensionLine}`,
    };
  });
  return mapped;
}

const mapDimension = (dm) => {
  const unit = dm.unit ? ` ${dm.unit}` : '';
  const l = dm.length ?? '';
  const w = dm.width ?? '';
  const th = dm.thickness ?? '';

  const parts = [l, w, th].filter(Boolean);
  if (parts.length === 0) return '';
  return `${parts.join(' × ')}${unit}`.trim();
  // return `${l} × ${w} × ${th}${unit}`.trim();
  // return { label: `${l} × ${w} × ${th}${unit}`.trim(), value: String(dm._id) };
};

const mapPacking = (p) => {
  return `${[p.name,
  p?.brandType && !p?.brandType.includes('branded') ? p.brandType : '',
  p?.productColor || '']
    .filter(Boolean)
    .join(' ')
    }`
}



// GET /items/:id/status-history
export const getItemStatusHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findById(id, 'statusHistory').lean();
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const history = (item.statusHistory || []).sort((a, b) => new Date(b.at) - new Date(a.at));
    return res.json(history);
  } catch (error) {
    return handleError(res, error);
  }
};