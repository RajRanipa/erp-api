import mongoose from 'mongoose';
import ItemAttributeDefinition, {
  ATTRIBUTE_DATA_TYPES,
} from '../models/ItemAttributeDefinition.js';
import ItemClass, { ITEM_CLASS_CODES } from '../models/ItemClass.js';
import ItemFamily from '../models/ItemFamily.js';
import {
  createItemMaster,
  assessItemMasterDeletion,
  deleteItemMaster,
  familyFormSchema,
  getItemMaster,
  listItemMasters,
  listItemMasterOptions,
  listItemSetup,
  normalizeAttributeCode,
  normalizeMasterCode,
  transitionItemMaster,
  updateItemMaster,
} from '../services/itemMasterService.js';
import { sendCreated, sendSuccess } from '../utils/apiResponse.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'ITEM_MASTER_REQUEST_INVALID', details = null) =>
  new AppError(message, { statusCode, code, details });

const companyIdFromRequest = req => {
  const companyId = req.user?.companyId || req.user?.company?._id || req.user?.company;
  if (!mongoose.isValidObjectId(companyId)) {
    throw fail('A valid company context is required', 401, 'COMPANY_CONTEXT_REQUIRED');
  }
  return companyId;
};

const actorIdFromRequest = req =>
  req.user?.userId || req.user?.id || req.user?._id || null;

const capabilitiesFrom = (input = {}, fallback = {}) => ({
  inventory: input.inventory ?? fallback.inventory ?? true,
  purchasable: input.purchasable ?? fallback.purchasable ?? false,
  manufacturable: input.manufacturable ?? fallback.manufacturable ?? false,
  consumable: input.consumable ?? fallback.consumable ?? false,
  sellable: input.sellable ?? fallback.sellable ?? false,
});

const duplicateError = (error, label) => {
  if (error?.code === 11000) {
    return fail(`${label} code already exists`, 409, 'DUPLICATE_MASTER_CODE');
  }
  return error;
};

export async function getItemMasterSetup(req, res) {
  try {
    return sendSuccess(res, { data: await listItemSetup(companyIdFromRequest(req)) });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function createItemClass(req, res) {
  try {
    const companyId = companyIdFromRequest(req);
    const code = normalizeMasterCode(req.body?.code);
    const name = String(req.body?.name || '').trim();
    if (!ITEM_CLASS_CODES.includes(code)) {
      throw fail(`Item Class code must be one of: ${ITEM_CLASS_CODES.join(', ')}`);
    }
    if (!name) throw fail('Item Class name is required');
    const created = await ItemClass.create({
      companyId,
      code,
      name,
      description: String(req.body?.description || '').trim(),
      capabilities: capabilitiesFrom(req.body?.capabilities),
      system: false,
      createdBy: actorIdFromRequest(req),
      updatedBy: actorIdFromRequest(req),
    });
    return sendCreated(res, { data: created, message: 'Item Class created' });
  } catch (error) {
    return handleError(res, duplicateError(error, 'Item Class'), req);
  }
}

export async function createAttributeDefinition(req, res) {
  try {
    const companyId = companyIdFromRequest(req);
    const code = normalizeAttributeCode(req.body?.code);
    const label = String(req.body?.label || '').trim();
    const dataType = String(req.body?.dataType || '').trim().toLowerCase();
    if (!code || !label) throw fail('Attribute code and label are required');
    if (!ATTRIBUTE_DATA_TYPES.includes(dataType)) {
      throw fail(`Attribute dataType must be one of: ${ATTRIBUTE_DATA_TYPES.join(', ')}`);
    }
    const allowedValues = dataType === 'select'
      ? (req.body?.allowedValues || []).map((option, index) => ({
        value: String(option?.value || '').trim(),
        label: String(option?.label || option?.value || '').trim(),
        sortOrder: Number(option?.sortOrder ?? index),
        active: option?.active !== false,
      })).filter(option => option.value && option.label)
      : [];
    if (dataType === 'select' && !allowedValues.length) {
      throw fail('Select attributes require at least one allowed value');
    }
    const created = await ItemAttributeDefinition.create({
      companyId,
      code,
      label,
      description: String(req.body?.description || '').trim(),
      dataType,
      unit: req.body?.unit ? String(req.body.unit).trim().toLowerCase() : null,
      referenceModel: req.body?.referenceModel || null,
      referenceFamilyCode: req.body?.referenceFamilyCode
        ? normalizeMasterCode(req.body.referenceFamilyCode)
        : null,
      allowedValues,
      validation: {
        min: req.body?.validation?.min ?? null,
        max: req.body?.validation?.max ?? null,
        precision: req.body?.validation?.precision ?? null,
        pattern: req.body?.validation?.pattern || null,
        maxLength: req.body?.validation?.maxLength ?? null,
      },
      createdBy: actorIdFromRequest(req),
      updatedBy: actorIdFromRequest(req),
    });
    return sendCreated(res, { data: created, message: 'Item attribute created' });
  } catch (error) {
    return handleError(res, duplicateError(error, 'Attribute'), req);
  }
}

async function normalizedFamilyPayload(req, existing = null) {
  const companyId = companyIdFromRequest(req);
  const classId = req.body?.itemClassId || existing?.itemClassId;
  if (!mongoose.isValidObjectId(classId)) throw fail('A valid Item Class is required');
  const itemClass = await ItemClass.findOne({
    _id: classId,
    companyId,
    status: 'active',
  }).lean();
  if (!itemClass) throw fail('Item Class was not found', 404, 'ITEM_CLASS_NOT_FOUND');

  const inputRules = req.body?.attributeRules ?? existing?.attributeRules ?? [];
  const attributeIds = inputRules.map(rule => rule.attributeId);
  if (attributeIds.some(id => !mongoose.isValidObjectId(id))) {
    throw fail('Every family attribute rule requires a valid attributeId');
  }
  const definitions = await ItemAttributeDefinition.find({
    _id: { $in: attributeIds },
    companyId,
    status: 'active',
  }).select('_id').lean();
  if (definitions.length !== new Set(attributeIds.map(String)).size) {
    throw fail('One or more family attributes are missing or inactive');
  }
  const seen = new Set();
  const attributeRules = inputRules.map((rule, index) => {
    const key = String(rule.attributeId);
    if (seen.has(key)) throw fail('An attribute can only appear once in an Item Family');
    seen.add(key);
    return {
      attributeId: rule.attributeId,
      required: Boolean(rule.required),
      identity: Boolean(rule.identity),
      searchable: rule.searchable !== false,
      displayOrder: Number(rule.displayOrder ?? index),
      defaultValue: rule.defaultValue ?? null,
    };
  });

  const uomPolicy = req.body?.uomPolicy ?? existing?.uomPolicy ?? {};
  const baseUom = String(uomPolicy.baseUom || '').trim().toLowerCase();
  if (!baseUom) throw fail('Item Family base UOM is required');
  const catchMode = String(uomPolicy.catchMode || 'NONE').toUpperCase();
  if (!['NONE', 'MEASURED', 'DERIVED', 'NOMINAL'].includes(catchMode)) {
    throw fail('Invalid catch quantity mode');
  }
  const catchUom = uomPolicy.catchUom
    ? String(uomPolicy.catchUom).trim().toLowerCase()
    : null;
  if (catchMode !== 'NONE' && !catchUom) {
    throw fail('Catch UOM is required when catch quantity is enabled');
  }
  if (catchMode === 'NOMINAL' && !(Number(uomPolicy.nominalFactor) > 0)) {
    throw fail('Nominal factor must be greater than zero');
  }

  const code = normalizeMasterCode(req.body?.code ?? existing?.code);
  const name = String(req.body?.name ?? existing?.name ?? '').trim();
  const skuPrefix = normalizeMasterCode(req.body?.skuPrefix ?? existing?.skuPrefix ?? code);
  if (!code || !name || !skuPrefix) {
    throw fail('Family code, name and SKU prefix are required');
  }
  return {
    companyId,
    itemClassId: itemClass._id,
    code,
    name,
    description: String(req.body?.description ?? existing?.description ?? '').trim(),
    capabilities: capabilitiesFrom(req.body?.capabilities, itemClass.capabilities),
    attributeRules,
    uomPolicy: {
      baseUom,
      catchUom,
      catchMode,
      nominalFactor: catchMode === 'NOMINAL' ? Number(uomPolicy.nominalFactor) : null,
    },
    trackingPolicy: {
      lotTracked: req.body?.trackingPolicy?.lotTracked
        ?? existing?.trackingPolicy?.lotTracked
        ?? true,
      serialTracked: req.body?.trackingPolicy?.serialTracked
        ?? existing?.trackingPolicy?.serialTracked
        ?? false,
      serialControlMode: req.body?.trackingPolicy?.serialControlMode
        ?? existing?.trackingPolicy?.serialControlMode
        ?? ((req.body?.trackingPolicy?.serialTracked
          ?? existing?.trackingPolicy?.serialTracked) ? 'INFORMATIONAL' : 'NONE'),
      expiryTracked: req.body?.trackingPolicy?.expiryTracked
        ?? existing?.trackingPolicy?.expiryTracked
        ?? false,
    },
    skuPrefix,
  };
}

export async function createItemFamily(req, res) {
  try {
    const payload = await normalizedFamilyPayload(req);
    const created = await ItemFamily.create({
      ...payload,
      status: req.body?.status === 'active' ? 'active' : 'draft',
      createdBy: actorIdFromRequest(req),
      updatedBy: actorIdFromRequest(req),
    });
    return sendCreated(res, { data: created, message: 'Item Family created' });
  } catch (error) {
    return handleError(res, duplicateError(error, 'Item Family'), req);
  }
}

export async function updateItemFamily(req, res) {
  try {
    const companyId = companyIdFromRequest(req);
    const family = await ItemFamily.findOne({ _id: req.params.id, companyId });
    if (!family) throw fail('Item Family was not found', 404, 'ITEM_FAMILY_NOT_FOUND');
    if (family.status === 'archived') {
      throw fail('Archived Item Families cannot be edited', 409, 'ITEM_FAMILY_ARCHIVED');
    }
    const payload = await normalizedFamilyPayload(req, family.toObject());
    Object.assign(family, payload, {
      version: family.version + 1,
      updatedBy: actorIdFromRequest(req),
    });
    if (req.body?.status && ['draft', 'active'].includes(req.body.status)) {
      family.status = req.body.status;
    }
    await family.save();
    return sendSuccess(res, { data: family, message: 'Item Family updated' });
  } catch (error) {
    return handleError(res, duplicateError(error, 'Item Family'), req);
  }
}

export async function getFamilyForm(req, res) {
  try {
    return sendSuccess(res, {
      data: await familyFormSchema(companyIdFromRequest(req), req.params.id),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function createMasterItem(req, res) {
  try {
    const data = await createItemMaster(
      companyIdFromRequest(req),
      actorIdFromRequest(req),
      req.body,
    );
    return sendCreated(res, { data, message: 'Item created as Draft' });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function listMasterItems(req, res) {
  try {
    const result = await listItemMasters(companyIdFromRequest(req), req.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function listMasterItemOptions(req, res) {
  try {
    return sendSuccess(res, {
      data: await listItemMasterOptions(companyIdFromRequest(req), req.query),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getMasterItem(req, res) {
  try {
    return sendSuccess(res, {
      data: await getItemMaster(companyIdFromRequest(req), req.params.id),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function getMasterItemDeletionAssessment(req, res) {
  try {
    return sendSuccess(res, {
      data: await assessItemMasterDeletion(companyIdFromRequest(req), req.params.id),
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function deleteMasterItem(req, res) {
  try {
    const deleted = await deleteItemMaster(
      companyIdFromRequest(req),
      req.params.id,
      req.body?.confirmation,
    );
    return sendSuccess(res, {
      data: { id: deleted._id, sku: deleted.sku },
      message: `Item ${deleted.sku} permanently deleted`,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function updateMasterItem(req, res) {
  try {
    const data = await updateItemMaster(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      req.body,
    );
    return sendSuccess(res, { data, message: 'Item updated' });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function changeMasterItemStatus(req, res) {
  try {
    const data = await transitionItemMaster(
      companyIdFromRequest(req),
      req.params.id,
      actorIdFromRequest(req),
      String(req.body?.to || '').trim().toLowerCase(),
      req.body?.reason,
    );
    return sendSuccess(res, { data, message: `Item moved to ${data.status}` });
  } catch (error) {
    return handleError(res, error, req);
  }
}
