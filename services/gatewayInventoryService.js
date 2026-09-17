import ItemFamily from '../models/ItemFamily.js';
import ItemMaster from '../models/ItemMaster.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import Warehouse from '../models/Warehouse.js';
import {
  postGatewayPackedBlanketReceipt,
  postReceipt,
} from './inventoryService.js';
import { AppError } from '../utils/errorHandler.js';

export const GATEWAY_SIZE_CODE_MAP = Object.freeze({
  1: Object.freeze({ length: 7300, width: 610, thickness: 25 }),
  2: Object.freeze({ length: 3650, width: 610, thickness: 50 }),
  3: Object.freeze({ length: 7320, width: 610, thickness: 25 }),
  4: Object.freeze({ length: 7620, width: 610, thickness: 25 }),
  5: Object.freeze({ length: 7300, width: 610, thickness: 12 }),
  8: Object.freeze({ length: 8000, width: 600, thickness: 30 }),
});

export const GATEWAY_PRODUCT_FAMILY = Object.freeze({
  1: 'BLANKET',
  2: 'BULK',
  3: 'BOARD',
  4: 'MODULE',
  5: 'ET',
});

export const shouldAutoPackGatewayReceipt = (familyCode, receiptInput = {}) =>
  normalizeCode(familyCode) === 'BLANKET'
  && normalizeCode(receiptInput.qualityStatus) === 'AVAILABLE';

const normalizeCode = value => String(value ?? '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '');

const escapeRegex = value =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const finiteNumber = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new AppError(`${field} must be a finite number`, {
      statusCode: 400,
      code: 'INVALID_GATEWAY_RECORD',
      details: { field, value },
    });
  }
  return number;
};

const normalizedNumber = (value, field) => String(finiteNumber(value, field));

export function gatewayIdentityForRecord({
  productCode,
  temperatureValue,
  densityValue,
  sizeCode,
}) {
  const numericProductCode = Number(productCode);
  const familyCode = GATEWAY_PRODUCT_FAMILY[numericProductCode];
  if (!familyCode) {
    throw new AppError(`Unsupported gateway productCode: ${productCode}`, {
      statusCode: 400,
      code: 'INVALID_PRODUCT_CODE',
    });
  }

  const attributes = [{
    code: 'classification_temperature',
    normalizedValue: normalizedNumber(temperatureValue, 'temperature'),
  }];
  if (['BLANKET', 'MODULE'].includes(familyCode)) {
    attributes.push({
      code: 'density',
      normalizedValue: normalizedNumber(densityValue, 'density'),
    });
    const size = GATEWAY_SIZE_CODE_MAP[Number(sizeCode)];
    if (!size) {
      throw new AppError(`Unsupported gateway sizeCode: ${sizeCode}`, {
        statusCode: 400,
        code: 'INVALID_SIZE_CODE',
      });
    }
    attributes.push(
      { code: 'length', normalizedValue: String(size.length) },
      { code: 'width', normalizedValue: String(size.width) },
      { code: 'thickness', normalizedValue: String(size.thickness) },
    );
  }
  return { familyCode, attributes };
}

export function gatewayQuantityForItem(weightKg, item) {
  const weight = finiteNumber(weightKg, 'weight');
  if (weight <= 0) {
    throw new AppError('weight must be greater than zero', {
      statusCode: 400,
      code: 'INVALID_WEIGHT',
    });
  }
  const baseUom = String(item?.baseUom || '').trim().toLowerCase();
  if (baseUom === 'kg') return weight;
  if (['g', 'gram', 'grams'].includes(baseUom)) return weight * 1000;
  if (['ton', 'tonne', 't'].includes(baseUom)) return weight / 1000;
  if (['roll', 'rolls', 'nos', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'bag', 'bags']
    .includes(baseUom)) return 1;
  throw new AppError(`Gateway weight cannot be posted to Item Master UOM "${item?.baseUom}"`, {
    statusCode: 409,
    code: 'GATEWAY_UOM_MISMATCH',
  });
}

export function buildGatewayInventoryReceiptInput({
  companyId,
  warehouseId,
  gatewayId,
  recordId,
  scaleNo,
  weightKg,
  statusOk,
  productCode,
  batchNo,
  productionId,
  campaignId,
  at,
  item,
}) {
  const manufacturedAt = new Date(at);
  if (Number.isNaN(manufacturedAt.getTime())) {
    throw new AppError('Gateway manufacture date/time is invalid', {
      statusCode: 400,
      code: 'INVALID_GATEWAY_DATE',
    });
  }
  const weight = finiteNumber(weightKg, 'weight');
  const quantity = gatewayQuantityForItem(weight, item);
  const accepted = Boolean(statusOk) || Number(productCode) === 5;
  const qualitySuffix = accepted ? 'OK' : 'REJ';
  const productionDate = manufacturedAt.toISOString().slice(0, 10).replaceAll('-', '');
  const cleanBatchNo = normalizeCode(batchNo) || `GW-${productionDate}`;
  const hasKgCatch = String(item.catchUom || '').toLowerCase() === 'kg'
    && String(item.baseUom || '').toLowerCase() !== 'kg';
  const createsUnitTrace = Boolean(item.trackingPolicy?.serialTracked);

  return {
    idempotencyKey: `PROD_GATEWAY_V2:${companyId}:${gatewayId}:${recordId}:${scaleNo}`,
    itemId: item._id,
    warehouseId,
    quantity,
    catchQuantity: hasKgCatch ? weight : undefined,
    unitCost: Number(
      process.env.GATEWAY_DEFAULT_UNIT_COST
      || process.env.GATEWAY_V2_DEFAULT_UNIT_COST
      || 0,
    ),
    lotNo: `${cleanBatchNo}-${qualitySuffix}`.slice(0, 120),
    qualityStatus: accepted ? 'AVAILABLE' : 'REJECTED',
    processStatus: accepted ? 'AVAILABLE' : 'REJECTED',
    manufacturedAt,
    campaignId,
    sourceType: 'PROD_GATEWAY',
    sourceId: String(productionId),
    referenceType: 'PROD_GATEWAY',
    referenceId: String(productionId),
    receiptMode: 'PRODUCTION',
    units: createsUnitTrace
      ? [{
        catchQuantity: hasKgCatch ? weight : undefined,
        catchSource: 'PLC_PI',
        manufacturedAt,
        measuredAt: manufacturedAt,
      }]
      : undefined,
  };
}

export async function resolveGatewayWarehouseId(companyId) {
  const fixedId = process.env.GATEWAY_WAREHOUSE_ID;
  if (fixedId) {
    const warehouse = await Warehouse.findOne({
      _id: fixedId,
      companyId,
      status: 'active',
    }).select('_id').lean();
    return warehouse?._id || null;
  }
  const fixedCode = process.env.GATEWAY_WAREHOUSE_CODE;
  if (fixedCode) {
    const warehouse = await Warehouse.findOne({
      companyId,
      status: 'active',
      code: { $regex: new RegExp(`^${escapeRegex(fixedCode)}$`, 'i') },
    }).select('_id').lean();
    return warehouse?._id || null;
  }
  const fixedName = process.env.GATEWAY_WAREHOUSE_NAME;
  if (fixedName) {
    const warehouse = await Warehouse.findOne({
      companyId,
      status: 'active',
      name: { $regex: new RegExp(`^${escapeRegex(fixedName)}$`, 'i') },
    }).select('_id').lean();
    return warehouse?._id || null;
  }
  const warehouse = await Warehouse.findOne({ companyId, status: 'active' })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id')
    .lean();
  return warehouse?._id || null;
}

export async function resolveGatewayItem({
  companyId,
  legacyItemId = null,
  productCode,
  temperatureValue,
  densityValue,
  sizeCode,
}) {
  const { familyCode, attributes } = gatewayIdentityForRecord({
    productCode,
    temperatureValue,
    densityValue,
    sizeCode,
  });
  if (familyCode === 'BOARD') {
    return {
      item: null,
      familyCode,
      status: 'NOT_APPLICABLE',
      message: 'Board inventory must be posted through the Board Production Order workflow',
    };
  }
  const family = await ItemFamily.findOne({ companyId, code: familyCode, status: 'active' })
    .select('_id code')
    .lean();
  if (!family) {
    return {
      item: null,
      familyCode,
      status: 'PENDING_MAPPING',
      message: `Active Item Master family ${familyCode} was not found`,
    };
  }
  const directMatches = await ItemMaster.find({
    companyId,
    familyId: family._id,
    status: 'active',
    'capabilities.inventory': true,
    attributes: { $all: attributes.map(attribute => ({ $elemMatch: attribute })) },
  }).sort({ _id: 1 }).limit(2).lean();
  if (directMatches.length > 1) {
    return {
      item: null,
      familyCode,
      status: 'PENDING_MAPPING',
      message:
        `Multiple active ${familyCode} Item Master records match the PLC attributes; `
        + 'add a gateway discriminator or keep only one matching active Item',
    };
  }
  let item = directMatches[0] || null;
  if (!item && legacyItemId) {
    item = await ItemMaster.findOne({
      companyId,
      legacyItemId,
      familyId: family._id,
      status: 'active',
      'capabilities.inventory': true,
    }).lean();
  }
  if (!item) {
    return {
      item: null,
      familyCode,
      status: 'PENDING_MAPPING',
      message: `No active ${familyCode} Item Master record matches the PLC attributes`,
    };
  }
  return { item, familyCode, status: 'RESOLVED', message: null };
}

export async function postGatewayInventory(input) {
  const resolved = await resolveGatewayItem(input);
  if (!resolved.item) {
    return {
      posted: false,
      status: resolved.status,
      familyCode: resolved.familyCode,
      message: resolved.message,
    };
  }
  const receiptInput = buildGatewayInventoryReceiptInput({
    ...input,
    item: resolved.item,
  });
  const shouldAutoPack = shouldAutoPackGatewayReceipt(resolved.familyCode, receiptInput);
  const result = shouldAutoPack
    ? await postGatewayPackedBlanketReceipt(input.companyId, null, receiptInput)
    : await postReceipt(input.companyId, null, receiptInput);
  return {
    posted: true,
    status: 'POSTED',
    itemId: resolved.item._id,
    familyCode: resolved.familyCode,
    transactionId: result.transaction._id,
    serialId: result.serials?.[0]?._id || null,
    serialNo: result.serials?.[0]?.serialNo || null,
    duplicate: result.duplicate,
    message: null,
  };
}

const inventoryV2LinkFields = result => ({
  inventoryV2Posted: Boolean(result.posted),
  inventoryV2Status: result.status,
  inventoryV2LastError: result.message || null,
  inventoryV2LastAttemptAt: new Date(),
  inventoryV2ItemId: result.itemId || null,
  inventoryV2TransactionId: result.transactionId || null,
  inventoryV2SerialId: result.serialId || null,
  inventoryV2SerialNo: result.serialNo || null,
});

export async function postAndLinkGatewayInventory({ document, warehouseId }) {
  if (document.inventoryV2Posted) {
    return {
      posted: true,
      status: 'POSTED',
      itemId: document.inventoryV2ItemId || null,
      transactionId: document.inventoryV2TransactionId || null,
      serialId: document.inventoryV2SerialId || null,
      serialNo: document.inventoryV2SerialNo || null,
      duplicate: true,
      message: null,
    };
  }
  let result;
  if (!warehouseId) {
    result = {
      posted: false,
      status: 'PENDING_MAPPING',
      message: 'Active gateway warehouse was not found',
    };
  } else {
    try {
      result = await postGatewayInventory({
        companyId: document.companyId,
        legacyItemId: document.matchedItem || null,
        warehouseId,
        gatewayId: document.gatewayId,
        recordId: document.recordId,
        scaleNo: document.scaleNo,
        productCode: document.productCode,
        weightKg: document.weightKg,
        statusOk: document.statusOk,
        batchNo: document.batchNo,
        productionId: document._id,
        campaignId: document.campaign,
        at: document.at,
        temperatureValue: document.temperatureValue,
        densityValue: document.densityValue,
        sizeCode: document.sizeCode,
      });
    } catch (error) {
      result = {
        posted: false,
        status: 'FAILED',
        message: String(error?.message || error).slice(0, 1000),
      };
    }
  }
  await ProductionBlanketRoll.updateOne(
    { _id: document._id },
    { $set: inventoryV2LinkFields(result) },
  );
  return result;
}
