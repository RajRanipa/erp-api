import crypto from 'crypto';
import mongoose from 'mongoose';
import InventoryLotV2 from '../models/InventoryLotV2.js';
import InventoryTransactionV2 from '../models/InventoryTransactionV2.js';
import ItemMaster from '../models/ItemMaster.js';
import ManufacturingRecipeV2 from '../models/ManufacturingRecipeV2.js';
import ProductionOrderV2 from '../models/ProductionOrderV2.js';
import Warehouse from '../models/Warehouse.js';
import {
  postConversion,
  postMaterialIssue,
  postReceipt,
  transitionLotProcess,
} from './inventoryV2Service.js';
import { AppError } from '../utils/errorHandler.js';

const fail = (message, statusCode = 400, code = 'MANUFACTURING_V2_ERROR', details = null) =>
  new AppError(message, { statusCode, code, details });
const normalizeCode = value => String(value ?? '').trim().toUpperCase();
const positive = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw fail(`${field} must be greater than zero`, 400, 'INVALID_QUANTITY', { field });
  }
  return Number(number.toFixed(6));
};
const makeOrderNo = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `MO-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};
const populatedOrder = query => query
  .populate('outputItemId', 'sku name baseUom familyId')
  .populate('recipeId', 'code name revision status')
  .populate('materials.itemId', 'sku name baseUom')
  .populate('sourceWarehouseId', 'code name')
  .populate('outputWarehouseId', 'code name')
  .populate('outputLotIds', 'lotNo processStatus qualityStatus onHandQuantity');

const existingInventoryAction = (companyId, idempotencyKey) =>
  InventoryTransactionV2.findOne({ companyId, idempotencyKey }).lean();

async function activeOutputItem(companyId, itemId) {
  const item = await ItemMaster.findOne({
    _id: itemId,
    companyId,
    status: 'active',
    'capabilities.manufacturable': true,
  }).populate('familyId', 'code name').lean();
  if (!item) throw fail('Active manufacturable output Item was not found', 404, 'OUTPUT_ITEM_NOT_FOUND');
  return item;
}

export async function createRecipe(companyId, actorId, input = {}) {
  const output = await activeOutputItem(companyId, input.outputItemId);
  const basisQuantity = positive(input.basisQuantity || 1, 'basisQuantity');
  if (!Array.isArray(input.components) || !input.components.length) {
    throw fail('Recipe requires at least one material component', 400, 'RECIPE_COMPONENT_REQUIRED');
  }
  const componentIds = input.components.map(component => component.itemId);
  const components = await ItemMaster.find({
    _id: { $in: componentIds },
    companyId,
    status: 'active',
    'capabilities.consumable': true,
  }).lean();
  if (components.length !== new Set(componentIds.map(String)).size) {
    throw fail('Every component must be an active consumable Item', 409, 'INVALID_RECIPE_COMPONENT');
  }
  const stages = new Set(input.components.map(component => normalizeCode(component.stage || 'RELEASE')));
  if (output.familyId?.code === 'BOARD' && !stages.has('RELEASE')) {
    throw fail(
      'A Board recipe requires at least one raw-material component consumed at batch release',
      409,
      'BOARD_RAW_MATERIAL_REQUIRED',
    );
  }
  if (output.familyId?.code === 'BOARD' && !stages.has('PACKING')) {
    throw fail(
      'A Board recipe requires packing material; configure its quantity in the recipe',
      409,
      'BOARD_PACKING_MATERIAL_REQUIRED',
    );
  }
  const componentById = new Map(components.map(item => [String(item._id), item]));
  const recipe = await ManufacturingRecipeV2.create({
    companyId,
    outputItemId: output._id,
    code: normalizeCode(input.code),
    name: String(input.name || '').trim(),
    revision: Number(input.revision || 1),
    basisQuantity,
    outputUom: output.baseUom,
    expectedYieldPercent: Number(input.expectedYieldPercent || 100),
    components: input.components.map(component => ({
      itemId: component.itemId,
      quantity: positive(component.quantity, 'component.quantity'),
      uom: componentById.get(String(component.itemId)).baseUom,
      scrapPercent: Number(component.scrapPercent || 0),
      issueMethod: component.issueMethod || 'FIFO',
      stage: component.stage || 'RELEASE',
    })),
    byProducts: input.byProducts || [],
    operations: (input.operations || []).map((operation, index) => ({
      code: normalizeCode(operation.code),
      name: String(operation.name || '').trim(),
      sequence: Number(operation.sequence || index + 1),
      inventoryProcessStatus: normalizeCode(operation.inventoryProcessStatus),
      quantityCapture: Boolean(operation.quantityCapture),
      qualityGate: Boolean(operation.qualityGate),
    })),
    packingRule: input.packingRule || {},
    notes: String(input.notes || '').trim(),
    createdBy: actorId,
    updatedBy: actorId,
  });
  return recipe;
}

export async function activateRecipe(companyId, recipeId, actorId) {
  const recipe = await ManufacturingRecipeV2.findOne({ _id: recipeId, companyId });
  if (!recipe) throw fail('Recipe was not found', 404, 'RECIPE_NOT_FOUND');
  if (recipe.status !== 'DRAFT') {
    throw fail('Only a Draft recipe can be activated', 409, 'RECIPE_NOT_DRAFT');
  }
  await ManufacturingRecipeV2.updateMany(
    {
      companyId,
      outputItemId: recipe.outputItemId,
      status: 'ACTIVE',
      _id: { $ne: recipe._id },
    },
    { $set: { status: 'OBSOLETE', updatedBy: actorId } },
  );
  recipe.status = 'ACTIVE';
  recipe.updatedBy = actorId;
  await recipe.save();
  return recipe;
}

export async function listRecipes(companyId, query = {}) {
  const filter = { companyId };
  if (query.status) filter.status = normalizeCode(query.status);
  if (query.outputItemId) filter.outputItemId = query.outputItemId;
  return ManufacturingRecipeV2.find(filter)
    .populate('outputItemId', 'sku name baseUom familyId')
    .populate('components.itemId', 'sku name baseUom')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
}

export async function createProductionOrder(companyId, actorId, input = {}) {
  const plannedQuantity = positive(input.plannedQuantity, 'plannedQuantity');
  const output = await activeOutputItem(companyId, input.outputItemId);
  const recipe = await ManufacturingRecipeV2.findOne({
    _id: input.recipeId,
    companyId,
    outputItemId: output._id,
    status: 'ACTIVE',
  }).lean();
  if (!recipe) throw fail('Active recipe was not found for this Item', 404, 'ACTIVE_RECIPE_NOT_FOUND');
  const warehouseCount = await Warehouse.countDocuments({
    _id: { $in: [input.sourceWarehouseId, input.outputWarehouseId] },
    companyId,
    status: 'active',
  });
  const expectedWarehouseCount = String(input.sourceWarehouseId) === String(input.outputWarehouseId)
    ? 1
    : 2;
  if (warehouseCount !== expectedWarehouseCount) {
    throw fail('Source and output Warehouses must be active', 409, 'INVALID_PRODUCTION_WAREHOUSE');
  }
  const scale = plannedQuantity / recipe.basisQuantity;
  const order = await ProductionOrderV2.create({
    companyId,
    orderNo: normalizeCode(input.orderNo) || makeOrderNo(),
    outputItemId: output._id,
    recipeId: recipe._id,
    recipeRevision: recipe.revision,
    plannedQuantity,
    outputUom: output.baseUom,
    sourceWarehouseId: input.sourceWarehouseId,
    outputWarehouseId: input.outputWarehouseId,
    materials: recipe.components.map(component => ({
      itemId: component.itemId,
      plannedQuantity: Number((
        component.quantity * scale * (1 + component.scrapPercent / 100)
      ).toFixed(6)),
      uom: component.uom,
      stage: component.stage,
    })),
    operations: [...recipe.operations]
      .sort((left, right) => left.sequence - right.sequence)
      .map(operation => ({
        code: operation.code,
        name: operation.name,
        sequence: operation.sequence,
        inventoryProcessStatus: operation.inventoryProcessStatus,
      })),
    notes: String(input.notes || '').trim(),
    createdBy: actorId,
    updatedBy: actorId,
  });
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

export async function releaseProductionOrder(companyId, orderId, actorId, input = {}) {
  const order = await ProductionOrderV2.findOne({ _id: orderId, companyId });
  if (!order) throw fail('Production Order was not found', 404, 'PRODUCTION_ORDER_NOT_FOUND');
  if (order.status !== 'DRAFT') {
    if (order.status === 'RELEASED' || order.status === 'IN_PROGRESS') {
      return populatedOrder(ProductionOrderV2.findById(order._id));
    }
    throw fail('Only a Draft Production Order can be released', 409, 'ORDER_NOT_DRAFT');
  }
  const releaseMaterials = order.materials.filter(material => material.stage === 'RELEASE');
  const result = await postMaterialIssue(companyId, actorId, {
    idempotencyKey: `mo-release:${order._id}`,
    referenceType: 'PRODUCTION_ORDER',
    referenceId: String(order._id),
    note: `Materials issued when ${order.orderNo} was released`,
    lines: releaseMaterials.map(material => ({
      itemId: material.itemId,
      warehouseId: order.sourceWarehouseId,
      quantity: material.plannedQuantity,
      ...(input.lotSelections?.[String(material.itemId)] || {}),
    })),
  });
  order.materialIssueTransactionId = result.transaction._id;
  order.materialValue = result.transaction.totalValueOut;
  for (const material of order.materials) {
    if (material.stage === 'RELEASE') material.issuedQuantity = material.plannedQuantity;
  }
  order.status = 'RELEASED';
  order.startedAt = new Date();
  order.updatedBy = actorId;
  await order.save();
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

async function boardOrder(companyId, orderId) {
  const order = await ProductionOrderV2.findOne({ _id: orderId, companyId })
    .populate({ path: 'outputItemId', populate: { path: 'familyId', select: 'code' } });
  if (!order) throw fail('Production Order was not found', 404, 'PRODUCTION_ORDER_NOT_FOUND');
  if (order.outputItemId?.familyId?.code !== 'BOARD') {
    throw fail('This workflow is only for Board Production Orders', 409, 'NOT_A_BOARD_ORDER');
  }
  return order;
}

export async function drawBoard(companyId, orderId, actorId, input = {}) {
  const order = await boardOrder(companyId, orderId);
  const actionKey = `board-draw:${order._id}`;
  const existing = await existingInventoryAction(companyId, actionKey);
  if (existing) {
    const receipt = existing.entries.find(entry => entry.direction === 'IN');
    if (receipt?.lotId && !order.outputLotIds.some(id => String(id) === String(receipt.lotId))) {
      order.outputLotIds = [receipt.lotId];
      order.actualOutputQuantity = receipt.quantity;
      order.status = 'IN_PROGRESS';
      order.updatedBy = actorId;
      await order.save();
    }
    return populatedOrder(ProductionOrderV2.findById(order._id));
  }
  if (!['RELEASED', 'IN_PROGRESS'].includes(order.status)) {
    throw fail('Board Order must be released before drawing', 409, 'ORDER_NOT_RELEASED');
  }
  if (order.outputLotIds.length) {
    throw fail('Board draw has already been posted for this Order', 409, 'BOARD_ALREADY_DRAWN');
  }
  const quantity = positive(input.quantity, 'quantity');
  const unitCost = order.materialValue / quantity;
  const result = await postReceipt(companyId, actorId, {
    idempotencyKey: actionKey,
    itemId: order.outputItemId._id,
    warehouseId: order.outputWarehouseId,
    quantity,
    unitCost,
    lotNo: input.lotNo || `${order.orderNo}-DRAW`,
    qualityStatus: 'HOLD',
    processStatus: 'DRAWN',
    sourceType: 'PRODUCTION_ORDER',
    sourceId: String(order._id),
    referenceType: 'PRODUCTION_ORDER',
    referenceId: String(order._id),
  });
  const lotId = result.transaction.entries.find(entry => entry.direction === 'IN')?.lotId;
  order.outputLotIds = [lotId];
  order.actualOutputQuantity = quantity;
  order.status = 'IN_PROGRESS';
  order.updatedBy = actorId;
  await order.save();
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

export async function advanceBoardLot(companyId, orderId, actorId, input = {}) {
  const order = await boardOrder(companyId, orderId);
  if (!order.outputLotIds.some(id => String(id) === String(input.lotId))) {
    throw fail('Lot does not belong to this Board Order', 409, 'ORDER_LOT_MISMATCH');
  }
  await transitionLotProcess(companyId, actorId, {
    lotId: input.lotId,
    toProcessStatus: input.toProcessStatus,
    idempotencyKey:
      `board-stage:${order._id}:${input.lotId}:${normalizeCode(input.toProcessStatus)}`,
    referenceType: 'PRODUCTION_ORDER',
    referenceId: String(order._id),
  });
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

export async function inspectBoardLot(companyId, orderId, actorId, input = {}) {
  const order = await boardOrder(companyId, orderId);
  const actionKey = `board-qc:${order._id}:${input.lotId}`;
  const existing = await existingInventoryAction(companyId, actionKey);
  if (existing) {
    const outputs = existing.entries.filter(entry => entry.direction === 'IN');
    const outputLotIds = outputs.map(entry => entry.lotId).filter(Boolean);
    order.outputLotIds = order.outputLotIds
      .filter(id => String(id) !== String(input.lotId))
      .concat(outputLotIds.filter(id =>
        !order.outputLotIds.some(current => String(current) === String(id))
      ));
    order.rejectedQuantity = outputs
      .filter(entry => entry.qualityStatus === 'REJECTED')
      .reduce((total, entry) => total + Number(entry.quantity || 0), 0);
    if (!outputs.some(entry => entry.qualityStatus === 'AVAILABLE')) {
      order.status = 'COMPLETED';
      order.completedAt ||= new Date();
    }
    order.updatedBy = actorId;
    await order.save();
    return populatedOrder(ProductionOrderV2.findById(order._id));
  }
  const lot = await InventoryLotV2.findOne({
    _id: input.lotId,
    companyId,
    itemId: order.outputItemId._id,
    processStatus: 'DRIED_AWAITING_QC',
    status: 'OPEN',
  }).lean();
  if (!lot) throw fail('Board lot is not awaiting QC', 409, 'BOARD_LOT_NOT_AWAITING_QC');
  const acceptedQuantity = Number(input.acceptedQuantity || 0);
  const rejectedQuantity = Number(input.rejectedQuantity || 0);
  if (
    acceptedQuantity < 0
    || rejectedQuantity < 0
    || Math.abs(acceptedQuantity + rejectedQuantity - lot.onHandQuantity) > 0.000001
  ) {
    throw fail('Accepted plus rejected quantity must equal the lot quantity', 400, 'QC_QUANTITY_MISMATCH');
  }
  const outputs = [];
  if (acceptedQuantity > 0) {
    outputs.push({
      itemId: order.outputItemId._id,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      quantity: acceptedQuantity,
      lotNo: `${lot.lotNo}-A`,
      qualityStatus: 'AVAILABLE',
      processStatus: 'DRIED_AWAITING_QC',
      costAllocationWeight: acceptedQuantity,
    });
  }
  if (rejectedQuantity > 0) {
    outputs.push({
      itemId: order.outputItemId._id,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      quantity: rejectedQuantity,
      lotNo: `${lot.lotNo}-R`,
      qualityStatus: 'REJECTED',
      processStatus: 'REJECTED',
      costAllocationWeight: rejectedQuantity,
    });
  }
  const result = await postConversion(companyId, actorId, {
    idempotencyKey: actionKey,
    referenceType: 'BOARD_QC',
    referenceId: String(order._id),
    inputs: [{
      itemId: order.outputItemId._id,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      lotNo: lot.lotNo,
      processStatus: 'DRIED_AWAITING_QC',
      qualityStatus: 'HOLD',
      quantity: lot.onHandQuantity,
    }],
    outputs,
  });
  const newLotIds = result.transaction.entries
    .filter(entry => entry.direction === 'IN')
    .map(entry => entry.lotId);
  order.outputLotIds = order.outputLotIds
    .filter(id => String(id) !== String(lot._id))
    .concat(newLotIds);
  order.rejectedQuantity = rejectedQuantity;
  if (acceptedQuantity === 0) {
    order.status = 'COMPLETED';
    order.completedAt = new Date();
  }
  order.updatedBy = actorId;
  await order.save();
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

export async function packBoardLot(companyId, orderId, actorId, input = {}) {
  const order = await boardOrder(companyId, orderId);
  const actionKey = `board-pack:${order._id}:${input.lotId}`;
  const existing = await existingInventoryAction(companyId, actionKey);
  if (existing) {
    const packed = existing.entries.find(entry =>
      entry.direction === 'IN' && entry.processStatus === 'PACKED'
    );
    order.outputLotIds = order.outputLotIds
      .filter(id => String(id) !== String(input.lotId));
    if (
      packed?.lotId
      && !order.outputLotIds.some(id => String(id) === String(packed.lotId))
    ) {
      order.outputLotIds.push(packed.lotId);
    }
    for (const material of order.materials) {
      if (material.stage !== 'PACKING') continue;
      const issued = existing.entries
        .filter(entry =>
          entry.direction === 'OUT'
          && String(entry.itemId) === String(material.itemId)
        )
        .reduce((total, entry) => total + Number(entry.quantity || 0), 0);
      if (issued > 0) material.issuedQuantity = issued;
    }
    order.status = 'COMPLETED';
    order.completedAt ||= new Date();
    order.updatedBy = actorId;
    await order.save();
    return populatedOrder(ProductionOrderV2.findById(order._id));
  }
  const lot = await InventoryLotV2.findOne({
    _id: input.lotId,
    companyId,
    itemId: order.outputItemId._id,
    processStatus: 'EDGED',
    qualityStatus: 'AVAILABLE',
    status: 'OPEN',
  }).lean();
  if (!lot) throw fail('Accepted edged Board lot was not found', 409, 'BOARD_LOT_NOT_READY_TO_PACK');
  const recipe = await ManufacturingRecipeV2.findById(order.recipeId).lean();
  const packingLines = recipe.components.filter(component => component.stage === 'PACKING');
  const scale = lot.onHandQuantity / recipe.basisQuantity;
  const inputs = [{
    itemId: order.outputItemId._id,
    warehouseId: lot.warehouseId,
    bin: lot.bin,
    lotNo: lot.lotNo,
    processStatus: 'EDGED',
    qualityStatus: 'AVAILABLE',
    quantity: lot.onHandQuantity,
  }, ...packingLines.map(component => ({
    itemId: component.itemId,
    warehouseId: order.sourceWarehouseId,
    quantity: Number((component.quantity * scale).toFixed(6)),
  }))];
  const result = await postConversion(companyId, actorId, {
    idempotencyKey: actionKey,
    referenceType: 'BOARD_PACKING',
    referenceId: String(order._id),
    inputs,
    outputs: [{
      itemId: order.outputItemId._id,
      warehouseId: lot.warehouseId,
      bin: lot.bin,
      quantity: lot.onHandQuantity,
      lotNo: `${lot.lotNo}-PK`,
      qualityStatus: 'AVAILABLE',
      processStatus: 'PACKED',
      costAllocationWeight: 1,
    }],
  });
  const packedLot = result.transaction.entries.find(entry => entry.direction === 'IN')?.lotId;
  order.outputLotIds = order.outputLotIds
    .filter(id => String(id) !== String(lot._id))
    .concat(packedLot);
  for (const material of order.materials) {
    if (material.stage === 'PACKING') {
      const component = packingLines.find(row =>
        String(row.itemId) === String(material.itemId)
      );
      material.issuedQuantity = component
        ? Number((component.quantity * scale).toFixed(6))
        : material.issuedQuantity;
    }
  }
  order.status = 'COMPLETED';
  order.completedAt = new Date();
  order.updatedBy = actorId;
  await order.save();
  return populatedOrder(ProductionOrderV2.findById(order._id));
}

const attributeValue = (item, code) =>
  item.attributes?.find(attribute => attribute.code === code)?.normalizedValue ?? null;

export async function processChopping(companyId, actorId, input = {}) {
  const batchNo = normalizeCode(input.batchNo);
  if (!batchNo) {
    throw fail('Chopping batch number is required', 400, 'CHOPPING_BATCH_NO_REQUIRED');
  }
  if (!Array.isArray(input.inputs) || !input.inputs.length) {
    throw fail('Chopping requires ET, rejected Blanket or Chopped Fibre inputs', 400, 'CHOPPING_INPUT_REQUIRED');
  }
  const output = await ItemMaster.findOne({
    _id: input.outputItemId,
    companyId,
    status: 'active',
  }).populate('familyId', 'code').lean();
  if (!output || output.familyId?.code !== 'CHOPPED_FIBRE') {
    throw fail('Output must be an active Chopped Fibre Item', 409, 'INVALID_CHOPPED_OUTPUT');
  }
  const inputItems = await ItemMaster.find({
    _id: { $in: input.inputs.map(row => row.itemId) },
    companyId,
    status: 'active',
  }).populate('familyId', 'code').lean();
  const itemById = new Map(inputItems.map(item => [String(item._id), item]));
  const families = new Set(inputItems.map(item => item.familyId?.code));
  const secondChop = families.size === 1 && families.has('CHOPPED_FIBRE');
  if (!secondChop && [...families].some(code => !['ET', 'BLANKET'].includes(code))) {
    throw fail(
      'First chopping may only mix ET and rejected Blanket',
      409,
      'INVALID_CHOPPING_INPUT_FAMILY',
    );
  }
  const outputGrade = attributeValue(output, 'chopping_grade');
  if (secondChop && outputGrade !== 'double') {
    throw fail('Second chopping output must be Double Chopped', 409, 'INVALID_SECOND_CHOP_OUTPUT');
  }
  if (!secondChop && outputGrade !== 'normal') {
    throw fail('First chopping output must be Normal Chopped', 409, 'INVALID_FIRST_CHOP_OUTPUT');
  }
  const temperature = attributeValue(output, 'classification_temperature');
  for (const row of input.inputs) {
    const item = itemById.get(String(row.itemId));
    if (!item) throw fail('A chopping input Item was not found', 404, 'CHOPPING_ITEM_NOT_FOUND');
    if (
      attributeValue(item, 'classification_temperature') !== temperature
    ) {
      throw fail(
        'Chopping inputs and output must share the same classification temperature',
        409,
        'CHOPPING_SEGREGATION_MISMATCH',
      );
    }
    if (item.familyId?.code === 'BLANKET' && normalizeCode(row.qualityStatus) !== 'REJECTED') {
      throw fail(
        'Only rejected Blanket may be consumed by chopping',
        409,
        'ACCEPTED_BLANKET_CHOP_NOT_ALLOWED',
      );
    }
    if (
      ['ET', 'CHOPPED_FIBRE'].includes(item.familyId?.code)
      && normalizeCode(row.qualityStatus || 'AVAILABLE') !== 'AVAILABLE'
    ) {
      throw fail(
        'Only available ET or Chopped Fibre may be consumed',
        409,
        'CHOPPING_INPUT_NOT_AVAILABLE',
      );
    }
    if (
      secondChop
      && attributeValue(item, 'chopping_grade') !== 'normal'
    ) {
      throw fail('Only Normal Chopped Fibre can be chopped a second time', 409, 'INVALID_SECOND_CHOP_INPUT');
    }
  }
  return postConversion(companyId, actorId, {
    // The business document number is the idempotency boundary. Retrying the
    // same batch can never consume its stored inputs twice.
    idempotencyKey: `chopping-batch:${batchNo}`,
    referenceType: 'CHOPPING_BATCH',
    referenceId: batchNo,
    captureWeightYield: true,
    note: input.note || (secondChop ? 'Second chopping conversion' : 'ET / rejected Blanket chopping'),
    inputs: input.inputs.map(row => ({
      ...row,
      processStatus: row.processStatus
        || (itemById.get(String(row.itemId))?.familyId?.code === 'BLANKET'
          ? 'REJECTED'
          : 'AVAILABLE'),
    })),
    outputs: [{
      itemId: output._id,
      warehouseId: input.outputWarehouseId,
      bin: input.outputBin,
      quantity: positive(input.outputQuantity, 'outputQuantity'),
      lotNo: input.outputLotNo || batchNo,
      qualityStatus: 'AVAILABLE',
      processStatus: 'AVAILABLE',
      costAllocationWeight: 1,
    }],
  });
}

export async function listProductionOrders(companyId, query = {}) {
  const filter = { companyId };
  if (query.status) filter.status = normalizeCode(query.status);
  if (query.outputItemId) filter.outputItemId = query.outputItemId;
  return populatedOrder(
    ProductionOrderV2.find(filter).sort({ createdAt: -1 }).limit(200)
  ).lean();
}

export async function getProductionOrder(companyId, orderId) {
  const order = await populatedOrder(ProductionOrderV2.findOne({ _id: orderId, companyId })).lean();
  if (!order) throw fail('Production Order was not found', 404, 'PRODUCTION_ORDER_NOT_FOUND');
  return order;
}
