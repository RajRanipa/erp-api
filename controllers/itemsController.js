import mongoose from 'mongoose';
import Item, { STATUS } from '../models/Item.js';
import Category from '../models/Category.js';
import InventorySnapshot from '../models/InventorySnapshot.js';
import InventoryLedger from '../models/InventoryLedger.js';
import { AppError, handleError } from '../utils/errorHandler.js';
import { applyAuditCreate, applyAuditUpdate } from '../utils/auditHelper.js';

const ITEM_MUTABLE_FIELDS = new Set([
  'name',
  'sku',
  'category',
  'UOM',
  'minimumStock',
  'purchasePrice',
  'salePrice',
  'description',
  'raw_specificField1',
  'raw_specificField2',
  'grade',
  'productType',
  'temperature',
  'density',
  'dimension',
  'packing',
  'brandType',
  'productColor',
]);

const REFERENCE_FIELDS = new Set([
  'category',
  'productType',
  'temperature',
  'density',
  'dimension',
  'packing',
]);

const NUMBER_FIELDS = new Set([
  'minimumStock',
  'purchasePrice',
  'salePrice',
]);

const ITEM_IDENTITY_FIELDS = new Set([
  'name',
  'sku',
  'category',
  'UOM',
  'grade',
  'productType',
  'temperature',
  'density',
  'dimension',
  'packing',
  'brandType',
  'productColor',
]);

const INVENTORY_IDENTITY_FIELDS = new Set([
  'category',
  'UOM',
  'productType',
]);

const ITEM_LIST_POPULATE = [
  { path: 'category', select: 'name' },
  { path: 'productType', select: 'name categories' },
  { path: 'temperature', select: 'value unit productType' },
  { path: 'density', select: 'value unit productType' },
  { path: 'dimension', select: 'length width thickness unit category productType' },
  { path: 'packing', select: 'name sku brandType productColor dimension' },
  { path: 'createdBy', select: 'fullName' },
  { path: 'updatedBy', select: 'fullName' },
];

const STATUS_VALUES = new Set(Object.values(STATUS));

const fail = (message, statusCode = 400, code = 'ITEM_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function companyIdFromRequest(req) {
  const companyId =
    req.user?.companyId ||
    req.user?.company?._id ||
    req.user?.company;

  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw fail('A valid company is required', 401, 'COMPANY_REQUIRED');
  }

  return companyId;
}

function validateObjectId(value, fieldName) {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`${fieldName} is invalid`, 400, 'INVALID_ID', { field: fieldName });
  }
}

function categoryKeyFromName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  const keys = {
    'raw material': 'RAW',
    'finished goods': 'FG',
    'packing material': 'PACKING',
    'non-conformance': 'NC',
  };
  return keys[normalized] || null;
}

function normalizeItemPayload(body = {}) {
  const payload = {};

  for (const [field, rawValue] of Object.entries(body)) {
    if (!ITEM_MUTABLE_FIELDS.has(field)) continue;

    if (REFERENCE_FIELDS.has(field)) {
      if (rawValue === '' || rawValue === null) {
        payload[field] = null;
      } else {
        validateObjectId(rawValue, field);
        payload[field] = rawValue;
      }
      continue;
    }

    if (NUMBER_FIELDS.has(field)) {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        payload[field] = 0;
        continue;
      }
      const numberValue = Number(rawValue);
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        throw fail(`${field} must be a non-negative number`, 400, 'INVALID_NUMBER', {
          field,
        });
      }
      payload[field] = numberValue;
      continue;
    }

    if (typeof rawValue === 'string') {
      payload[field] = rawValue.trim();
    } else {
      payload[field] = rawValue;
    }
  }

  if ('name' in payload) payload.name = String(payload.name || '').replace(/\s+/g, ' ').trim();
  if ('sku' in payload) payload.sku = String(payload.sku || '').toUpperCase();
  if ('UOM' in payload) payload.UOM = String(payload.UOM || '').toLowerCase();
  if ('grade' in payload) payload.grade = String(payload.grade || '').toLowerCase();
  if ('brandType' in payload && !payload.brandType) payload.brandType = undefined;
  if ('productColor' in payload) payload.productColor = String(payload.productColor || '').toLowerCase();

  return payload;
}

const valuesDiffer = (left, right) =>
  String(left ?? '') !== String(right ?? '');

async function resolveCategory(categoryId) {
  if (!categoryId) {
    throw fail('Category is required', 400, 'CATEGORY_REQUIRED');
  }
  validateObjectId(categoryId, 'category');

  const category = await Category.findById(categoryId).select('_id name').lean();
  if (!category) {
    throw fail('Category not found', 400, 'INVALID_CATEGORY');
  }

  const categoryKey = categoryKeyFromName(category.name);
  if (!categoryKey) {
    throw fail(
      `Unsupported Item category: ${category.name}`,
      400,
      'UNSUPPORTED_CATEGORY',
    );
  }

  return { category, categoryKey };
}

async function populateItem(item) {
  if (!item) return null;
  await item.populate(ITEM_LIST_POPULATE);
  return item;
}

function toEditPayload(item) {
  const doc = item?.toObject ? item.toObject() : item;
  if (!doc) return null;

  return {
    ...doc,
    category: doc.category?._id || doc.category || '',
    category_label: doc.category?.name || '',
    productType: doc.productType?._id || doc.productType || '',
    productType_label: doc.productType?.name || '',
    temperature: doc.temperature?._id || doc.temperature || '',
    density: doc.density?._id || doc.density || '',
    dimension: doc.dimension?._id || doc.dimension || '',
    packing: doc.packing?._id || doc.packing || '',
  };
}

function applyItemFilters(req, baseFilter = {}, defaultStatus = STATUS.ACTIVE) {
  const filter = { ...baseFilter, companyId: companyIdFromRequest(req) };
  const {
    categoryKey,
    productType,
    temperature,
    density,
    dimension,
    packing,
    status,
    search,
  } = req.query || {};

  if (categoryKey) {
    const normalizedKey = String(categoryKey).toUpperCase();
    if (!['FG', 'RAW', 'PACKING', 'NC'].includes(normalizedKey)) {
      throw fail('categoryKey must be FG, RAW, PACKING or NC', 400, 'INVALID_CATEGORY_KEY');
    }
    filter.categoryKey = normalizedKey;
  }

  for (const [field, value] of Object.entries({
    productType,
    temperature,
    density,
    dimension,
    packing,
  })) {
    if (!value) continue;
    validateObjectId(value, field);
    filter[field] = value;
  }

  if (typeof status === 'string' && status.toLowerCase() !== 'all') {
    const statuses = status
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    const invalid = statuses.find(value => !STATUS_VALUES.has(value));
    if (invalid) {
      throw fail(`Invalid Item status: ${invalid}`, 400, 'INVALID_STATUS');
    }
    if (statuses.length) filter.status = { $in: statuses };
  } else if (!status && defaultStatus) {
    filter.status = defaultStatus;
  }

  if (search && String(search).trim()) {
    const pattern = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [
      { name: pattern },
      { sku: pattern },
      { grade: pattern },
      { description: pattern },
    ];
  }

  return filter;
}

async function listItems(req, baseFilter = {}, defaultStatus = STATUS.ACTIVE) {
  const filter = applyItemFilters(req, baseFilter, defaultStatus);

  if (req.query?.inStockOnly === 'true' || req.query?.inStockOnly === '1') {
    const itemIds = await InventorySnapshot.distinct('itemId', {
      companyId: filter.companyId,
      onHand: { $gt: 0 },
    });
    if (!itemIds.length) return [];
    filter._id = { $in: itemIds };
  }

  return Item.find(filter)
    .populate(ITEM_LIST_POPULATE)
    .sort({ name: 1, grade: 1, createdAt: -1 })
    .lean();
}

export const createItem = async (req, res) => {
  try {
    const companyId = companyIdFromRequest(req);
    const normalized = normalizeItemPayload(req.body);
    const { categoryKey } = await resolveCategory(normalized.category);

    const payload = applyAuditCreate(req, {
      ...normalized,
      companyId,
      categoryKey,
      status: STATUS.DRAFT,
    });

    const item = await Item.create(payload);
    await populateItem(item);

    return res.status(201).json({
      success: true,
      message: 'Item created as draft',
      data: item,
      item,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getItemById = async (req, res) => {
  try {
    const id = req.params.id || req.query.id;
    validateObjectId(id, 'item id');

    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    }).populate(ITEM_LIST_POPULATE);

    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');
    return res.json(toEditPayload(item));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllItems = async (req, res) => {
  try {
    return res.json(await listItems(req));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllItemsOptions = async (req, res) => {
  try {
    const filter = applyItemFilters(req);
    const items = await Item.find(filter)
      .select('_id name sku grade UOM categoryKey productType status size temperature density')
      .lean()
      .populate('temperature', 'value unit')
      .populate('density', 'value unit')
      .populate('packing', 'name brandType productColor')
      .populate('dimension', 'width length thickness unit');;

    return res.json(items);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllItemsOptions_old = async (req, res) => {
  // console.log('req.query in getAllItems', req.query);
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

    const items = await Item.find(filter).lean().populate('temperature', 'value unit')
      .populate('density', 'value unit')
      .populate('packing', 'name brandType productColor')
      .populate('dimension', 'width length thickness unit');
    // // console.log('items in getAllItems (count)', items?.length || 0, 'items', items[0]);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};


export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    validateObjectId(id, 'item id');

    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    });
    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');
    if (item.status === STATUS.ARCHIVED) {
      throw fail('Archived Items cannot be edited', 409, 'ITEM_ARCHIVED');
    }

    const normalized = normalizeItemPayload(req.body);
    const changedIdentityFields = Object.keys(normalized).filter(field =>
      ITEM_IDENTITY_FIELDS.has(field) &&
      valuesDiffer(normalized[field], item[field])
    );
    if (
      changedIdentityFields.length &&
      ![STATUS.DRAFT, STATUS.REJECTED].includes(item.status)
    ) {
      throw fail(
        'Item specifications can only be changed while the Item is draft or rejected',
        409,
        'ITEM_SPECIFICATIONS_LOCKED',
        { fields: changedIdentityFields },
      );
    }

    const changedInventoryIdentityFields = changedIdentityFields.filter(field =>
      INVENTORY_IDENTITY_FIELDS.has(field)
    );
    if (changedInventoryIdentityFields.length) {
      const [hasLedger, hasSnapshot] = await Promise.all([
        InventoryLedger.exists({ companyId: item.companyId, itemId: item._id }),
        InventorySnapshot.exists({ companyId: item.companyId, itemId: item._id }),
      ]);
      if (hasLedger || hasSnapshot) {
        throw fail(
          'Category, UOM and product type cannot change after inventory activity exists',
          409,
          'INVENTORY_IDENTITY_LOCKED',
          { fields: changedInventoryIdentityFields },
        );
      }
    }

    const categoryId = normalized.category || item.category;
    const { categoryKey } = await resolveCategory(categoryId);
    const update = applyAuditUpdate(req, {
      ...normalized,
      category: categoryId,
      categoryKey,
    });

    Object.assign(item, update);
    await item.save();
    await populateItem(item);

    return res.json({
      success: true,
      message: 'Item updated',
      data: item,
      item,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE archives an Item. It never hard-deletes master data because inventory,
 * BOM, batch, QC, and production records retain Item references for audit.
 */
export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    validateObjectId(id, 'item id');

    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    });
    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');

    if (item.status !== STATUS.ARCHIVED) {
      await item.setStatus(STATUS.ARCHIVED, {
        userId: req.user?.userId || req.user?.id || req.user?._id,
        reason: 'Archived from Item module',
      });
    }

    return res.json({
      success: true,
      message: 'Item archived',
      data: item,
      item,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const targetStatus = String(req.body?.to || req.body?.status || '')
      .trim()
      .toLowerCase();
    validateObjectId(id, 'item id');

    if (!STATUS_VALUES.has(targetStatus)) {
      throw fail('A valid target status is required', 400, 'INVALID_STATUS');
    }

    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    });
    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');

    await item.setStatus(targetStatus, {
      userId: req.user?.userId || req.user?.id || req.user?._id,
      reason: String(req.body?.reason || '').trim(),
    });

    return res.json({
      success: true,
      message: 'Item status updated',
      data: item,
      item,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getPackingItems = async (req, res) => {
  try {
    return res.json(await listItems(req, { categoryKey: 'PACKING' }, null));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getFinishedItems = async (req, res) => {
  try {
    return res.json(await listItems(req, { categoryKey: 'FG' }, null));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getRawItems = async (req, res) => {
  try {
    return res.json(await listItems(req, { categoryKey: 'RAW' }, null));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getNCItems = async (req, res) => {
  try {
    return res.json(await listItems(req, { categoryKey: 'NC' }, null));
  } catch (error) {
    return handleError(res, error);
  }
};

export const getPackingItemsByid = async (req, res) => {
  try {
    const { productType } = req.query || {};
    validateObjectId(productType, 'productType');

    const packings = await Item.find({
      companyId: companyIdFromRequest(req),
      categoryKey: 'PACKING',
      productType,
      status: STATUS.ACTIVE,
    })
      .select('_id name sku brandType productColor grade dimension')
      .populate('dimension', 'width length thickness unit')
      .sort({ name: 1, grade: 1 })
      .lean();

    const options = packings.map(item => {
      const dimension = item.dimension
        ? [
          item.dimension.length,
          item.dimension.width,
          item.dimension.thickness,
        ].filter(value => value !== null && value !== undefined).join(' × ')
        : '';
      const dimensionLabel = dimension
        ? `${dimension} ${item.dimension.unit || ''}`.trim()
        : '';
      const specification = [
        item.brandType,
        item.productColor,
        item.grade,
        dimensionLabel,
      ].filter(Boolean).join(' · ');

      return {
        value: String(item._id),
        label: specification ? `${item.name} — ${specification}` : item.name,
      };
    });

    return res.json(options);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getItemStatusHistory = async (req, res) => {
  try {
    const { id } = req.params;
    validateObjectId(id, 'item id');
    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    })
      .select('statusHistory')
      .populate('statusHistory.userId', 'fullName')
      .lean();

    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');
    const history = [...(item.statusHistory || [])].sort(
      (a, b) => new Date(b.at) - new Date(a.at),
    );
    return res.json(history);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getItemUomById = async (req, res) => {
  try {
    const { id } = req.params;
    validateObjectId(id, 'item id');
    const item = await Item.findOne({
      _id: id,
      companyId: companyIdFromRequest(req),
    })
      .select('UOM categoryKey status')
      .lean();

    if (!item) throw fail('Item not found', 404, 'ITEM_NOT_FOUND');
    return res.json({
      status: true,
      message: 'UOM fetched',
      data: {
        uom: item.UOM,
        categoryKey: item.categoryKey,
        status: item.status,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
