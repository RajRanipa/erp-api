import crypto from 'crypto';
import mongoose from 'mongoose';
import ItemAttributeDefinition from '../models/ItemAttributeDefinition.js';
import ItemClass from '../models/ItemClass.js';
import ItemFamily from '../models/ItemFamily.js';
import ItemMaster, { ITEM_MASTER_STATUSES } from '../models/ItemMaster.js';
import InventoryBalanceV2 from '../models/InventoryBalanceV2.js';
import InventoryCostBalance from '../models/InventoryCostBalance.js';
import InventoryLotV2 from '../models/InventoryLotV2.js';
import InventorySerialV2 from '../models/InventorySerialV2.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';
import ManufacturingRecipeV2 from '../models/ManufacturingRecipeV2.js';
import ProductionOrderV2 from '../models/ProductionOrderV2.js';
import { AppError } from '../utils/errorHandler.js';

const EDITABLE_STATUSES = new Set(['draft', 'returned']);
const STATUS_TRANSITIONS = Object.freeze({
  draft: ['in_review', 'archived'],
  in_review: ['approved', 'returned', 'archived'],
  returned: ['in_review', 'archived'],
  approved: ['active', 'archived'],
  active: ['blocked', 'archived'],
  blocked: ['active', 'archived'],
  archived: [],
});

const fail = (message, statusCode = 400, code = 'ITEM_MASTER_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });

export const isPermanentlyDeletableItemStatus = status => status !== 'active';

const normalizeWhitespace = value =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

export const normalizeMasterCode = value =>
  normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const normalizeAttributeCode = value =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeTextValue = value => normalizeWhitespace(value).toLowerCase();

const searchPrefixes = values => {
  const prefixes = new Set();
  for (const value of values) {
    const words = normalizeTextValue(value).split(/[^a-z0-9°]+/).filter(Boolean);
    for (const word of words) {
      const max = Math.min(word.length, 24);
      for (let length = 1; length <= max; length += 1) {
        prefixes.add(word.slice(0, length));
      }
    }
  }
  return [...prefixes].slice(0, 400);
};

const valueFromInput = (values, code) => {
  if (Array.isArray(values)) {
    const row = values.find(value =>
      normalizeAttributeCode(value?.code || value?.key) === code
    );
    return row?.value ?? row?.normalizedValue ?? null;
  }
  return values?.[code] ?? null;
};

function normalizeTypedValue(definition, rawValue) {
  const { dataType, validation = {} } = definition;
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  if (dataType === 'number') {
    let value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw fail(`${definition.label} must be a valid number`, 400, 'INVALID_ATTRIBUTE', {
        field: definition.code,
      });
    }
    if (validation.min !== null && validation.min !== undefined && value < validation.min) {
      throw fail(`${definition.label} must be at least ${validation.min}`, 400, 'INVALID_ATTRIBUTE');
    }
    if (validation.max !== null && validation.max !== undefined && value > validation.max) {
      throw fail(`${definition.label} must not exceed ${validation.max}`, 400, 'INVALID_ATTRIBUTE');
    }
    if (Number.isInteger(validation.precision)) {
      value = Number(value.toFixed(validation.precision));
    }
    return {
      valueNumber: value,
      normalizedValue: String(value),
      displayValue: `${value}${definition.unit ? ` ${definition.unit}` : ''}`,
    };
  }

  if (dataType === 'boolean') {
    const value = typeof rawValue === 'boolean'
      ? rawValue
      : ['true', '1', 'yes'].includes(String(rawValue).trim().toLowerCase());
    return {
      valueBoolean: value,
      normalizedValue: value ? 'true' : 'false',
      displayValue: value ? 'Yes' : 'No',
    };
  }

  if (dataType === 'date') {
    const value = new Date(rawValue);
    if (Number.isNaN(value.getTime())) {
      throw fail(`${definition.label} must be a valid date`, 400, 'INVALID_ATTRIBUTE');
    }
    return {
      valueDate: value,
      normalizedValue: value.toISOString(),
      displayValue: value.toISOString().slice(0, 10),
    };
  }

  if (dataType === 'reference') {
    if (!mongoose.isValidObjectId(rawValue)) {
      throw fail(`${definition.label} must reference a valid record`, 400, 'INVALID_ATTRIBUTE');
    }
    return {
      valueRef: new mongoose.Types.ObjectId(rawValue),
      normalizedValue: String(rawValue),
      displayValue: String(rawValue),
    };
  }

  const value = normalizeWhitespace(rawValue);
  if (!value) return null;
  if (validation.maxLength && value.length > validation.maxLength) {
    throw fail(`${definition.label} is too long`, 400, 'INVALID_ATTRIBUTE');
  }
  if (validation.pattern) {
    let pattern;
    try {
      pattern = new RegExp(validation.pattern);
    } catch {
      throw fail(
        `${definition.label} has an invalid configured validation pattern`,
        500,
        'INVALID_ATTRIBUTE_CONFIGURATION',
      );
    }
    if (!pattern.test(value)) {
      throw fail(`${definition.label} has an invalid value`, 400, 'INVALID_ATTRIBUTE');
    }
  }

  if (dataType === 'select') {
    const option = (definition.allowedValues || []).find(candidate =>
      candidate.active !== false &&
      normalizeTextValue(candidate.value) === normalizeTextValue(value)
    );
    if (!option) {
      throw fail(`${definition.label} must use an allowed value`, 400, 'INVALID_ATTRIBUTE', {
        field: definition.code,
      });
    }
    return {
      valueString: option.value,
      normalizedValue: normalizeTextValue(option.value),
      displayValue: option.label,
    };
  }

  return {
    valueString: value,
    normalizedValue: normalizeTextValue(value),
    displayValue: value,
  };
}

async function loadFamily(companyId, familyId, { allowDraft = false } = {}) {
  if (!mongoose.isValidObjectId(familyId)) {
    throw fail('A valid Item Family is required', 400, 'INVALID_ITEM_FAMILY');
  }
  const statuses = allowDraft ? ['draft', 'active'] : ['active'];
  const family = await ItemFamily.findOne({
    _id: familyId,
    companyId,
    status: { $in: statuses },
  })
    .populate('itemClassId')
    .populate('attributeRules.attributeId')
    .lean();
  if (!family) throw fail('Item Family was not found or is not active', 404, 'ITEM_FAMILY_NOT_FOUND');
  if (!family.itemClassId || family.itemClassId.status !== 'active') {
    throw fail('Item Family has no active Item Class', 409, 'ITEM_CLASS_INACTIVE');
  }
  return family;
}

export function normalizeItemAttributes(family, suppliedValues = {}) {
  const attributes = [];
  const identity = [];

  for (const rule of [...(family.attributeRules || [])].sort(
    (left, right) => left.displayOrder - right.displayOrder
  )) {
    const definition = rule.attributeId;
    if (!definition || definition.status !== 'active') {
      throw fail('Item Family contains an inactive attribute definition', 409, 'FAMILY_CONFIGURATION_INVALID');
    }
    const rawValue = valueFromInput(suppliedValues, definition.code);
    const typed = normalizeTypedValue(definition, rawValue ?? rule.defaultValue);
    if (!typed) {
      if (rule.required) {
        throw fail(`${definition.label} is required`, 400, 'REQUIRED_ATTRIBUTE_MISSING', {
          field: definition.code,
        });
      }
      continue;
    }
    const row = {
      attributeId: definition._id,
      code: definition.code,
      dataType: definition.dataType,
      unit: definition.unit || null,
      ...typed,
    };
    attributes.push(row);
    if (rule.identity) identity.push(`${definition.code}=${typed.normalizedValue}`);
  }

  if (!identity.length) identity.push('family-default');
  return {
    attributes,
    fingerprint: identity.sort().join('|'),
  };
}

const generatedSku = (family, fingerprint) => {
  const digest = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 10).toUpperCase();
  return `${normalizeMasterCode(family.skuPrefix || family.code)}-${digest}`;
};

const populatedItemQuery = query => query
  .populate('itemClassId', 'code name capabilities status')
  .populate('familyId', 'code name uomPolicy trackingPolicy capabilities status')
  .populate('attributes.attributeId', 'code label dataType unit')
  .populate('createdBy', 'fullName')
  .populate('updatedBy', 'fullName');

export async function familyFormSchema(companyId, familyId) {
  const family = await loadFamily(companyId, familyId, { allowDraft: true });
  return {
    id: family._id,
    code: family.code,
    name: family.name,
    status: family.status,
    itemClass: family.itemClassId,
    capabilities: family.capabilities,
    uomPolicy: family.uomPolicy,
    trackingPolicy: family.trackingPolicy,
    attributes: [...(family.attributeRules || [])]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map(rule => ({
        id: rule.attributeId._id,
        code: rule.attributeId.code,
        label: rule.attributeId.label,
        description: rule.attributeId.description,
        dataType: rule.attributeId.dataType,
        unit: rule.attributeId.unit,
        referenceModel: rule.attributeId.referenceModel,
        referenceFamilyCode: rule.attributeId.referenceFamilyCode,
        allowedValues: rule.attributeId.allowedValues,
        validation: rule.attributeId.validation,
        required: rule.required,
        identity: rule.identity,
        searchable: rule.searchable,
        defaultValue: rule.defaultValue,
      })),
  };
}

export async function createItemMaster(companyId, actorId, input = {}) {
  const family = await loadFamily(companyId, input.familyId);
  const { attributes, fingerprint } = normalizeItemAttributes(family, input.attributes);
  const sku = normalizeMasterCode(input.sku) || generatedSku(family, fingerprint);
  const name = normalizeWhitespace(input.name);
  if (!name) throw fail('Item name is required', 400, 'ITEM_NAME_REQUIRED');

  const searchValues = [
    sku,
    name,
    family.name,
    ...attributes.flatMap(attribute => [attribute.displayValue, attribute.normalizedValue]),
  ];
  const payload = {
    companyId,
    familyId: family._id,
    itemClassId: family.itemClassId._id,
    sku,
    name,
    description: normalizeWhitespace(input.description),
    attributes,
    attributeFingerprint: fingerprint,
    searchText: searchValues.join(' ').toLowerCase(),
    searchTokens: searchPrefixes(searchValues),
    baseUom: family.uomPolicy.baseUom,
    catchUom: family.uomPolicy.catchUom || null,
    catchMode: family.uomPolicy.catchMode || 'NONE',
    nominalFactor: family.uomPolicy.nominalFactor ?? null,
    trackingPolicy: family.trackingPolicy,
    capabilities: family.capabilities,
    minimumStock: Number(input.minimumStock || 0),
    status: 'draft',
    statusHistory: [{ from: null, to: 'draft', reason: 'Item created', by: actorId }],
    createdBy: actorId,
    updatedBy: actorId,
  };

  try {
    const created = await ItemMaster.create(payload);
    return populatedItemQuery(ItemMaster.findById(created._id));
  } catch (error) {
    if (error?.code === 11000) {
      throw fail(
        'An Item with this SKU or family specification identity already exists',
        409,
        'DUPLICATE_ITEM_MASTER',
        { key: error.keyPattern },
      );
    }
    throw error;
  }
}

export async function updateItemMaster(companyId, itemId, actorId, input = {}) {
  if (!mongoose.isValidObjectId(itemId)) throw fail('Invalid Item id', 400, 'INVALID_ITEM_ID');
  const item = await ItemMaster.findOne({ _id: itemId, companyId });
  if (!item) throw fail('Item was not found', 404, 'ITEM_MASTER_NOT_FOUND');
  if (!EDITABLE_STATUSES.has(item.status)) {
    throw fail(
      'Item identity can only be edited while Draft or Returned',
      409,
      'ITEM_MASTER_IDENTITY_LOCKED',
    );
  }

  const familyId = input.familyId || item.familyId;
  const family = await loadFamily(companyId, familyId);
  const suppliedAttributes = input.attributes ?? Object.fromEntries(
    item.attributes.map(attribute => [
      attribute.code,
      attribute.valueNumber
        ?? attribute.valueBoolean
        ?? attribute.valueDate
        ?? attribute.valueRef
        ?? attribute.valueString,
    ])
  );
  const { attributes, fingerprint } = normalizeItemAttributes(family, suppliedAttributes);
  const name = input.name === undefined ? item.name : normalizeWhitespace(input.name);
  if (!name) throw fail('Item name is required', 400, 'ITEM_NAME_REQUIRED');
  const sku = input.sku === undefined ? item.sku : normalizeMasterCode(input.sku);
  if (!sku) throw fail('SKU is required', 400, 'ITEM_SKU_REQUIRED');

  const searchValues = [
    sku,
    name,
    family.name,
    ...attributes.flatMap(attribute => [attribute.displayValue, attribute.normalizedValue]),
  ];
  Object.assign(item, {
    familyId: family._id,
    itemClassId: family.itemClassId._id,
    sku,
    name,
    description: input.description === undefined
      ? item.description
      : normalizeWhitespace(input.description),
    attributes,
    attributeFingerprint: fingerprint,
    searchText: searchValues.join(' ').toLowerCase(),
    searchTokens: searchPrefixes(searchValues),
    baseUom: family.uomPolicy.baseUom,
    catchUom: family.uomPolicy.catchUom || null,
    catchMode: family.uomPolicy.catchMode || 'NONE',
    nominalFactor: family.uomPolicy.nominalFactor ?? null,
    trackingPolicy: family.trackingPolicy,
    capabilities: family.capabilities,
    minimumStock: input.minimumStock === undefined
      ? item.minimumStock
      : Number(input.minimumStock),
    updatedBy: actorId,
  });
  try {
    await item.save();
    return populatedItemQuery(ItemMaster.findById(item._id));
  } catch (error) {
    if (error?.code === 11000) {
      throw fail('The updated Item duplicates an existing SKU or specification', 409, 'DUPLICATE_ITEM_MASTER');
    }
    throw error;
  }
}

export async function transitionItemMaster(companyId, itemId, actorId, to, reason = '') {
  if (!ITEM_MASTER_STATUSES.includes(to)) {
    throw fail('Invalid Item lifecycle status', 400, 'INVALID_ITEM_MASTER_STATUS');
  }
  const item = await ItemMaster.findOne({ _id: itemId, companyId });
  if (!item) throw fail('Item was not found', 404, 'ITEM_MASTER_NOT_FOUND');
  if (!(STATUS_TRANSITIONS[item.status] || []).includes(to)) {
    throw fail(
      `Invalid Item transition: ${item.status} → ${to}`,
      409,
      'INVALID_ITEM_MASTER_TRANSITION',
    );
  }
  const from = item.status;
  item.status = to;
  item.updatedBy = actorId;
  item.statusHistory.push({
    from,
    to,
    reason: normalizeWhitespace(reason),
    by: actorId,
  });
  await item.save();
  return populatedItemQuery(ItemMaster.findById(item._id));
}

export async function getItemMaster(companyId, itemId) {
  if (!mongoose.isValidObjectId(itemId)) throw fail('Invalid Item id', 400, 'INVALID_ITEM_ID');
  const item = await populatedItemQuery(ItemMaster.findOne({ _id: itemId, companyId }));
  if (!item) throw fail('Item was not found', 404, 'ITEM_MASTER_NOT_FOUND');
  return item;
}

const deletionDependencyChecks = Object.freeze([
  {
    code: 'INVENTORY_TRANSACTIONS',
    label: 'Posted inventory transactions',
    count: (companyId, itemId) => InventoryTransactionV2.countDocuments({
      companyId,
      'entries.itemId': itemId,
    }),
  },
  {
    code: 'INVENTORY_LOTS',
    label: 'Inventory lots',
    count: (companyId, itemId) => InventoryLotV2.countDocuments({ companyId, itemId }),
  },
  {
    code: 'PACKAGING_USAGE',
    label: 'Inventory lots packed with this Item',
    count: (companyId, itemId) => InventoryLotV2.countDocuments({
      companyId,
      'packagingComponents.itemId': itemId,
    }),
  },
  {
    code: 'INVENTORY_BALANCES',
    label: 'Inventory balance records',
    count: (companyId, itemId) => InventoryBalanceV2.countDocuments({ companyId, itemId }),
  },
  {
    code: 'INVENTORY_SERIALS',
    label: 'Inventory serial or barcode records',
    count: (companyId, itemId) => InventorySerialV2.countDocuments({ companyId, itemId }),
  },
  {
    code: 'INVENTORY_VALUATION',
    label: 'Inventory valuation records',
    count: (companyId, itemId) => InventoryCostBalance.countDocuments({ companyId, itemId }),
  },
  {
    code: 'MANUFACTURING_RECIPES',
    label: 'Manufacturing recipes or BOMs',
    count: (companyId, itemId) => ManufacturingRecipeV2.countDocuments({
      companyId,
      $or: [
        { outputItemId: itemId },
        { 'components.itemId': itemId },
        { 'byProducts.itemId': itemId },
        { 'packingRule.packItemId': itemId },
      ],
    }),
  },
  {
    code: 'PRODUCTION_ORDERS',
    label: 'Production orders',
    count: (companyId, itemId) => ProductionOrderV2.countDocuments({
      companyId,
      $or: [
        { outputItemId: itemId },
        { 'materials.itemId': itemId },
      ],
    }),
  },
]);

export async function assessItemMasterDeletion(companyId, itemId) {
  const item = await ItemMaster.findOne({ _id: itemId, companyId })
    .select('_id sku name status')
    .lean();
  if (!item) throw fail('Item was not found', 404, 'ITEM_MASTER_NOT_FOUND');

  const counts = await Promise.all(
    deletionDependencyChecks.map(check => check.count(companyId, item._id)),
  );
  const blockers = deletionDependencyChecks
    .map((check, index) => ({
      code: check.code,
      label: check.label,
      count: counts[index],
    }))
    .filter(check => check.count > 0);

  if (!isPermanentlyDeletableItemStatus(item.status)) {
    blockers.unshift({
      code: 'ITEM_IS_ACTIVE',
      label: 'An Active Item must be blocked or archived before permanent deletion',
      count: 1,
    });
  }

  return {
    item,
    allowed: blockers.length === 0,
    blockers,
    recommendation: blockers.length
      ? 'Preserve business history: block or archive this Item instead of deleting it.'
      : 'This inactive and unreferenced Item can be permanently deleted.',
  };
}

export async function deleteItemMaster(companyId, itemId, confirmation) {
  const assessment = await assessItemMasterDeletion(companyId, itemId);
  const suppliedConfirmation = String(confirmation || '').trim().toUpperCase();
  if (suppliedConfirmation !== assessment.item.sku) {
    throw fail(
      'Type the complete Item SKU to confirm permanent deletion',
      400,
      'ITEM_DELETE_CONFIRMATION_INVALID',
    );
  }
  if (!assessment.allowed) {
    throw fail(
      'This Item cannot be permanently deleted because business history depends on it',
      409,
      'ITEM_DELETE_BLOCKED',
      assessment,
    );
  }

  const result = await ItemMaster.deleteOne({
    _id: assessment.item._id,
    companyId,
    status: { $ne: 'active' },
  });
  if (result.deletedCount !== 1) {
    throw fail(
      'The Item changed while deletion was being confirmed. Refresh and try again.',
      409,
      'ITEM_DELETE_STALE',
    );
  }
  return assessment.item;
}

export async function listItemMasters(companyId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const filter = { companyId };
  if (query.cursor) {
    if (!mongoose.isValidObjectId(query.cursor)) throw fail('Invalid cursor', 400, 'INVALID_CURSOR');
    filter._id = { $lt: query.cursor };
  }
  if (query.familyId) filter.familyId = query.familyId;
  if (query.itemClassId) filter.itemClassId = query.itemClassId;
  for (const capability of [
    'inventory',
    'purchasable',
    'manufacturable',
    'consumable',
    'sellable',
  ]) {
    if (query[capability] === 'true') filter[`capabilities.${capability}`] = true;
    if (query[capability] === 'false') filter[`capabilities.${capability}`] = false;
  }
  if (query.status) {
    const statuses = String(query.status).split(',').map(value => value.trim()).filter(Boolean);
    if (statuses.some(status => !ITEM_MASTER_STATUSES.includes(status))) {
      throw fail('Invalid Item status filter', 400, 'INVALID_ITEM_MASTER_STATUS');
    }
    filter.status = { $in: statuses };
  }
  if (query.search) {
    const token = normalizeTextValue(query.search).split(/[^a-z0-9°]+/).filter(Boolean)[0];
    if (token) filter.searchTokens = token.slice(0, 24);
  }

  const rows = await populatedItemQuery(
    ItemMaster.find(filter).sort({ _id: -1 }).limit(limit + 1)
  ).lean();
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      limit,
      hasMore,
      nextCursor: hasMore ? String(data[data.length - 1]._id) : null,
    },
  };
}

export async function listItemMasterOptions(companyId, query = {}) {
  const familyCode = normalizeMasterCode(query.familyCode);
  if (!familyCode) {
    throw fail('Reference familyCode is required', 400, 'REFERENCE_FAMILY_REQUIRED');
  }
  const family = await ItemFamily.findOne({
    companyId,
    code: familyCode,
    status: 'active',
  }).select('_id').lean();
  if (!family) {
    throw fail('Reference Item Family was not found', 404, 'REFERENCE_FAMILY_NOT_FOUND');
  }

  const filter = {
    companyId,
    familyId: family._id,
    status: 'active',
  };
  const search = normalizeTextValue(query.search);
  if (search) {
    const token = search.split(/[^a-z0-9°]+/).filter(Boolean)[0];
    if (token) filter.searchTokens = token.slice(0, 24);
  }
  const rows = await ItemMaster.find(filter)
    .select('_id sku name attributes')
    .sort({ name: 1, sku: 1 })
    .limit(100)
    .lean();
  return rows.map(item => ({
    value: item._id,
    label: `${item.sku} — ${item.name}`,
  }));
}

export async function listItemSetup(companyId) {
  const [classes, families, attributes] = await Promise.all([
    ItemClass.find({ companyId, status: 'active' }).sort({ name: 1 }).lean(),
    ItemFamily.find({ companyId, status: { $ne: 'archived' } })
      .populate('itemClassId', 'code name')
      .sort({ name: 1 })
      .lean(),
    ItemAttributeDefinition.find({ companyId, status: 'active' }).sort({ label: 1 }).lean(),
  ]);
  return { classes, families, attributes };
}
