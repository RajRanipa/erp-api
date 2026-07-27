import mongoose from 'mongoose';
import BOM from '../models/BOM.js';
import InventoryLedger from '../models/InventoryLedger.js';
import Item from '../models/Item.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import WorkOrder from '../models/WorkOrder.js';
import {
  getSnapshot,
  issue as issueInventory,
  receive as receiveInventory,
  repack as repackInventory,
} from '../services/inventoryService.js';
import {
  fetchAndSendReport,
  fetchproduction,
  fetchproductionALL,
  getProductionDay,
  getProductionNight,
  getTodayDayShiftRange,
} from '../services/productionReportService.js';
import { AppError, handleError } from '../utils/errorHandler.js';

const MASS_TO_GRAMS = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  lb: 453.59237,
  lbs: 453.59237,
  tonne: 1000000,
  ton: 1000000,
  t: 1000000,
};

const fail = (message, status = 400) => {
  return new AppError(message, {
    statusCode: status,
    code: status === 404 ? 'PRODUCTION_NOT_FOUND' : 'PRODUCTION_REQUEST_INVALID',
  });
};

const convertQuantity = (quantity, fromUnit, toUnit) => {
  const value = Number(quantity);
  const from = String(fromUnit || '').trim().toLowerCase();
  const to = String(toUnit || '').trim().toLowerCase();
  if (!Number.isFinite(value) || value <= 0) throw fail('Quantity must be greater than 0');
  if (!from || !to) throw fail('UOM is required');
  if (from === to) return value;
  if (!MASS_TO_GRAMS[from] || !MASS_TO_GRAMS[to]) {
    throw fail(`Cannot convert quantity from ${fromUnit} to ${toUnit}`);
  }
  return (value * MASS_TO_GRAMS[from]) / MASS_TO_GRAMS[to];
};

export const getAllProduction = async (req, res) => {
  try {
    const { companyId } = req.user || {};
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate required' });
    }

    const { start, end } = getTodayDayShiftRange(startDate);
    const [data, specificData] = await Promise.all([
      fetchproduction(start, end, companyId),
      fetchproductionALL(start, end, companyId),
    ]);

    return res.json({
      success: true,
      count: data.length,
      data,
      specificData,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const getProductionReportDay = async (req, res) => {
  try {
    const response = await getProductionDay(req.query.date, req.user?.companyId);
    return res.json({
      success: true,
      count: response.data.length,
      data: response.data,
      batchReport: response.batchReport,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const getProductionReportNight = async (req, res) => {
  try {
    const response = await getProductionNight(req.query.date, req.user?.companyId);
    return res.json({
      success: true,
      count: response.data.length,
      data: response.data,
      batchReport: response.batchReport,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
};

export async function sentProductionReport(req, res) {
  try {
    const shift = String(req.body?.shift || '').trim().toUpperCase();
    if (!['DAY', 'NIGHT'].includes(shift)) {
      return res.status(400).json({
        success: false,
        message: 'shift must be DAY or NIGHT',
      });
    }

    const result = await fetchAndSendReport(shift);
    return res.json({
      success: true,
      message: result?.message || `${shift} production report sent successfully`,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export const createWorkOrder = async (req, res) => {
  let session;
  try {
    const {
      productId,
      quantityToProduce,
      unit,
      workOrderNumber,
      warehouseId,
      campaign,
    } = req.body || {};
    const { companyId, userId } = req.user || {};

    if (!companyId) throw fail('Missing companyId on user', 401);
    if (!productId || !quantityToProduce || !unit || !workOrderNumber || !warehouseId) {
      throw fail(
        'productId, quantityToProduce, unit, workOrderNumber and warehouseId are required'
      );
    }

    const quantity = Number(quantityToProduce);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw fail('quantityToProduce must be greater than 0');
    }

    const [product, bom] = await Promise.all([
      Item.findOne({ _id: productId, companyId })
        .select('_id companyId name categoryKey UOM status')
        .lean(),
      BOM.findOne({ product: productId }).lean(),
    ]);
    if (!product) throw fail('Finished-goods item not found', 404);
    if (product.categoryKey !== 'FG') throw fail('Work-order output must be an FG item');
    if (product.status !== 'active') throw fail('Work-order output Item must be active');
    if (!bom) throw fail('Bill of Materials not found for this item', 404);
    if (!Array.isArray(bom.items) || bom.items.length === 0) {
      throw fail('Bill of Materials has no component items');
    }

    const componentIds = bom.items.map((line) => line.item);
    const componentItems = await Item.find({
      _id: { $in: componentIds },
      companyId,
    })
      .select('_id companyId name categoryKey UOM status')
      .lean();
    const componentById = new Map(
      componentItems.map((item) => [String(item._id), item])
    );

    const materials = bom.items.map((line) => {
      const item = componentById.get(String(line.item));
      if (!item) throw fail(`BOM component item not found: ${line.item}`, 404);
      if (!['RAW', 'PACKING'].includes(item.categoryKey)) {
        throw fail(`${item.name} must be a RAW or PACKING component`);
      }
      if (item.status !== 'active') {
        throw fail(`${item.name} must be active before it can be consumed`);
      }
      const requiredInBomUom =
        Number(line.qtyPer) * quantity * (1 + Number(line.scrapPct || 0) / 100);
      return {
        item: item._id,
        quantity: convertQuantity(requiredInBomUom, line.uom, item.UOM),
        uom: item.UOM,
        itemName: item.name,
      };
    });

    session = await mongoose.startSession();
    let workOrderId;
    await session.withTransaction(async () => {
      const productionSteps = [
        { stepName: 'Mixing', status: 'In Progress', startedAt: new Date() },
        { stepName: 'Melting', status: 'Pending' },
        { stepName: 'Spinning', status: 'Pending' },
        { stepName: 'Needling/Pressing', status: 'Pending' },
        { stepName: 'Heat Process', status: 'Pending' },
        { stepName: 'Cutting', status: 'Pending' },
        { stepName: 'Packing', status: 'Pending' },
      ];

      const [workOrder] = await WorkOrder.create(
        [{
          companyId,
          campaign: campaign || undefined,
          sourceWarehouseId: warehouseId,
          workOrderNumber: String(workOrderNumber).trim(),
          product: productId,
          quantityToProduce: quantity,
          unit,
          currentStatus: 'In Progress - Mixing',
          productionSteps,
          materialsConsumed: materials.map(({ itemName, ...line }) => line),
        }],
        { session }
      );
      workOrderId = workOrder._id;

      for (const material of materials) {
        await issueInventory({
          companyId,
          itemId: material.item,
          warehouseId,
          uom: material.uom,
          qty: material.quantity,
          by: userId,
          note: `Material issued for work order ${workOrderNumber}`,
          refType: 'WORK_ORDER',
          refId: String(workOrder._id),
          session,
        });
      }
    });

    const workOrder = await WorkOrder.findById(workOrderId)
      .populate('product', 'name sku UOM categoryKey')
      .populate('materialsConsumed.item', 'name sku UOM categoryKey');
    return res.status(201).json({
      success: true,
      message: 'Work order created and component inventory issued',
      data: workOrder,
    });
  } catch (error) {
    if (error?.code === 11000) error.status = 409;
    return handleError(res, error, req);
  } finally {
    if (session) await session.endSession();
  }
};

export const getAllWorkOrders = async (req, res) => {
  try {
    const workOrders = await WorkOrder.find({ companyId: req.user?.companyId })
      .populate('product', 'name sku UOM categoryKey')
      .populate('materialsConsumed.item', 'name sku UOM categoryKey')
      .populate('sourceWarehouseId outputWarehouseId', 'code name')
      .sort({ createdAt: -1 });
    return res.json(workOrders);
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const updateWorkOrder = async (req, res) => {
  let session;
  try {
    const { newStatus, stepName, completedQuantity, outputWarehouseId } =
      req.body || {};
    const workOrder = await WorkOrder.findOne({
      _id: req.params.id,
      companyId: req.user?.companyId,
    });
    if (!workOrder) throw fail('Work order not found', 404);
    if (!newStatus) throw fail('newStatus is required');

    if (stepName) {
      const step = workOrder.productionSteps.find(
        (entry) => entry.stepName === stepName
      );
      if (!step) throw fail(`Production step '${stepName}' not found`);
      step.status = newStatus;
      if (newStatus === 'In Progress' && !step.startedAt) step.startedAt = new Date();
      if (newStatus === 'Complete') step.completedAt = new Date();
    }

    if (newStatus !== 'Complete') {
      workOrder.currentStatus = newStatus;
      await workOrder.save();
      return res.json({
        success: true,
        message: 'Work order updated',
        data: workOrder,
      });
    }

    if (workOrder.outputInventoryPosted) {
      throw fail('Finished output has already been posted for this work order', 409);
    }
    if (!outputWarehouseId) throw fail('outputWarehouseId is required on completion');

    const product = await Item.findById(workOrder.product)
      .select('_id UOM')
      .lean();
    if (!product) throw fail('Work-order output item not found', 404);
    const outputQty = Number(completedQuantity || workOrder.quantityToProduce);
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      throw fail('completedQuantity must be greater than 0');
    }

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await receiveInventory({
        companyId: req.user.companyId,
        itemId: workOrder.product,
        warehouseId: outputWarehouseId,
        uom: product.UOM,
        qty: convertQuantity(outputQty, workOrder.unit, product.UOM),
        by: req.user?.userId,
        note: `Finished output from work order ${workOrder.workOrderNumber}`,
        refType: 'WORK_ORDER_OUTPUT',
        refId: String(workOrder._id),
        session,
      });

      workOrder.currentStatus = 'Complete';
      workOrder.outputWarehouseId = outputWarehouseId;
      workOrder.outputInventoryPosted = true;
      await workOrder.save({ session });
    });

    return res.json({
      success: true,
      message: 'Work order completed and finished inventory received',
      data: workOrder,
    });
  } catch (error) {
    return handleError(res, error, req);
  } finally {
    if (session) await session.endSession();
  }
};

export const rePackProduct = async (req, res) => {
  try {
    const {
      fromItemId,
      toItemId,
      warehouseId,
      quantity,
      qty,
      uom,
      note = '',
      batchNo = null,
    } = req.body || {};
    if (!fromItemId || !toItemId || !warehouseId || !uom) {
      throw fail('fromItemId, toItemId, warehouseId and uom are required');
    }

    const result = await repackInventory({
      companyId: req.user?.companyId,
      fromItemId,
      toItemId,
      warehouseId,
      qty: quantity ?? qty,
      uom,
      by: req.user?.userId,
      note,
      refType: 'REPACK',
      batchNo,
    });
    return res.json({
      success: true,
      message: 'Product repacked successfully',
      data: result,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const getAllRePackingLogs = async (req, res) => {
  try {
    const rows = await InventoryLedger.find({
      companyId: req.user?.companyId,
      txnType: 'REPACK',
    })
      .populate('itemId', 'name sku UOM categoryKey')
      .populate('warehouseId', 'code name')
      .populate('by', 'fullName')
      .sort({ at: -1 })
      .limit(500)
      .lean();
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const getAllInventory = async (req, res) => {
  try {
    const rows = await getSnapshot({ companyId: req.user?.companyId });
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, req);
  }
};

export const getAllProduction1 = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const match = { companyId: new mongoose.Types.ObjectId(req.user.companyId) };
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    }

    const rows = await ProductionBlanketRoll.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$matchedItem',
          totalRecords: { $sum: 1 },
          totalWeight: { $sum: '$weightKg' },
        },
      },
      {
        $lookup: {
          from: 'items',
          localField: '_id',
          foreignField: '_id',
          as: 'item',
        },
      },
      { $unwind: { path: '$item', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          matchedItemId: '$_id',
          itemName: '$item.name',
          totalRecords: 1,
          totalWeight: 1,
        },
      },
    ]);
    return res.json(rows);
  } catch (error) {
    return handleError(res, error, req);
  }
};
