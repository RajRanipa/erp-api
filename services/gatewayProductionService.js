import Campaign from '../models/Campaign.js';
import GatewayIngestBatch from '../models/GatewayIngestBatch.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import {
  postAndLinkGatewayInventory,
  resolveGatewayWarehouseId,
} from './gatewayInventoryService.js';
import { AppError } from '../utils/errorHandler.js';

const SUPPORTED_PRODUCT_CODES = new Set([1, 2, 3, 4, 5]);
const SUPPORTED_SCALES = new Set([1, 2, 3]);

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatus(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['true', '1', 'ok', 'pass', 'yes'].includes(
    String(value || '').trim().toLowerCase(),
  );
}

async function runningCampaign(companyId) {
  return Campaign.findOne({ companyId, status: 'RUNNING' }).select('_id').lean();
}

function validateRecord(record) {
  const recordId = String(record?.recordId || '').trim();
  const scaleNo = Number(record?.scaleNo);
  const productCode = Number(record?.productCode);
  const temperatureValue = Number(record?.temperature);
  const densityValue = Number(record?.density);
  const sizeCode = Number(record?.sizeCode);
  const weightKg = Number(record?.weight);
  if (!recordId || recordId.length > 120) {
    throw new AppError('recordId is required and must not exceed 120 characters', {
      statusCode: 400,
      code: 'INVALID_RECORD_ID',
    });
  }
  if (!SUPPORTED_SCALES.has(scaleNo)) {
    throw new AppError(`Unsupported scaleNo: ${record?.scaleNo}`, {
      statusCode: 400,
      code: 'INVALID_SCALE',
    });
  }
  if (!SUPPORTED_PRODUCT_CODES.has(productCode)) {
    throw new AppError(`Unsupported productCode: ${record?.productCode}`, {
      statusCode: 400,
      code: 'INVALID_PRODUCT_CODE',
    });
  }
  for (const [field, value] of Object.entries({ temperatureValue, densityValue, sizeCode })) {
    if (!Number.isFinite(value)) {
      throw new AppError(`${field} must be a finite number`, {
        statusCode: 400,
        code: 'INVALID_GATEWAY_RECORD',
      });
    }
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new AppError('weight must be greater than zero', {
      statusCode: 400,
      code: 'INVALID_WEIGHT',
    });
  }
  return {
    recordId,
    scaleNo,
    productCode,
    temperatureValue,
    densityValue,
    sizeCode,
    weightKg,
    batchNo: String(record?.batchNo || '').trim(),
    at: safeDate(record?.at) || new Date(),
    statusOk: normalizeStatus(record?.status),
  };
}

function updateCampaignSummary(summary, record) {
  switch (record.productCode) {
    case 1:
      summary.blanketRolls += 1;
      summary.fiberKg += record.weightKg;
      if (record.statusOk) summary.goodFiberKg += record.weightKg;
      else summary.rejectedFiberKg += record.weightKg;
      break;
    case 2:
      summary.fiberKg += record.weightKg;
      if (record.statusOk) {
        summary.bulkKg += record.weightKg;
        summary.goodFiberKg += record.weightKg;
      } else summary.rejectedFiberKg += record.weightKg;
      break;
    case 5:
      summary.fiberKg += record.weightKg;
      summary.rejectedFiberKg += record.weightKg;
      break;
    default:
      break;
  }
}

export async function ingestBlanketBatch({ companyId, payload }) {
  if (!companyId) {
    throw new AppError('companyId is required for gateway ingestion', {
      statusCode: 400,
      code: 'MISSING_COMPANY',
    });
  }
  const {
    gatewayId,
    sentAt,
    records,
    clientBatchId = null,
    contractVersion = '1.0',
  } = payload || {};
  if (!gatewayId) {
    throw new AppError('gatewayId is required', { statusCode: 400, code: 'MISSING_GATEWAY' });
  }
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) {
    throw new AppError('records must contain between 1 and 100 entries', {
      statusCode: 400,
      code: 'INVALID_PAYLOAD',
    });
  }
  const campaign = await runningCampaign(companyId);
  if (!campaign) {
    throw new AppError('A running Campaign is required', {
      statusCode: 409,
      code: 'RUNNING_CAMPAIGN_REQUIRED',
    });
  }
  const batch = await GatewayIngestBatch.create({
    campaign: campaign._id,
    companyId,
    gatewayId: String(gatewayId),
    clientBatchId,
    contractVersion,
    sentAt: safeDate(sentAt),
    recordsCount: records.length,
    rawPayload: payload,
    processingStatus: 'RECEIVED',
  });
  console.info('[gateway:batch-saved]', JSON.stringify({
    gatewayId: String(gatewayId),
    clientBatchId,
    batchId: String(batch._id),
    records: records.length,
    campaignId: String(campaign._id),
  }));
  const warehouseId = await resolveGatewayWarehouseId(companyId);
  const summary = {
    received: records.length,
    inserted: 0,
    duplicates: 0,
    postedToInventory: 0,
    inventorySkipped: 0,
    inventoryPending: 0,
    failed: 0,
    errors: [],
    warnings: [],
    recordResults: [],
  };
  const campaignSummary = {
    blanketRolls: 0,
    bulkKg: 0,
    fiberKg: 0,
    goodFiberKg: 0,
    rejectedFiberKg: 0,
  };

  for (const rawRecord of records) {
    const result = {
      recordId: rawRecord?.recordId ? String(rawRecord.recordId) : null,
      scaleNo: Number(rawRecord?.scaleNo) || null,
      accepted: false,
      retryable: true,
      storageStatus: 'REJECTED',
      inventoryStatus: 'NOT_ATTEMPTED',
      code: null,
      message: null,
    };
    summary.recordResults.push(result);
    let record;
    let document;
    try {
      record = validateRecord(rawRecord);
      try {
        document = await ProductionBlanketRoll.create({
          companyId,
          campaign: campaign._id,
          gatewayId: String(gatewayId),
          ...record,
          ingestBatchId: batch._id,
        });
        summary.inserted += 1;
        result.storageStatus = 'INSERTED';
        console.info('[gateway:record-saved]', JSON.stringify({
          gatewayId: String(gatewayId),
          batchId: String(batch._id),
          recordId: record.recordId,
          scaleNo: record.scaleNo,
          productionId: String(document._id),
          weightKg: record.weightKg,
          storageStatus: result.storageStatus,
        }));
        updateCampaignSummary(campaignSummary, record);
      } catch (error) {
        if (error?.code !== 11000) throw error;
        document = await ProductionBlanketRoll.findOne({
          companyId,
          gatewayId: String(gatewayId),
          recordId: record.recordId,
          scaleNo: record.scaleNo,
        });
        if (!document) throw error;
        summary.duplicates += 1;
        result.storageStatus = 'DUPLICATE';
        console.info('[gateway:record-duplicate]', JSON.stringify({
          gatewayId: String(gatewayId),
          batchId: String(batch._id),
          recordId: record.recordId,
          scaleNo: record.scaleNo,
          productionId: String(document._id),
        }));
      }
      result.accepted = true;
      result.retryable = false;
      const inventory = await postAndLinkGatewayInventory({ document, warehouseId });
      result.inventoryStatus = inventory.status;
      result.code = inventory.posted || inventory.status === 'NOT_APPLICABLE'
        ? null
        : inventory.status;
      result.message = inventory.message;
      console.info('[gateway:inventory-result]', JSON.stringify({
        gatewayId: String(gatewayId),
        batchId: String(batch._id),
        recordId: record.recordId,
        scaleNo: record.scaleNo,
        productionId: String(document._id),
        inventoryStatus: inventory.status,
        posted: Boolean(inventory.posted),
        duplicate: Boolean(inventory.duplicate),
        message: inventory.message || null,
      }));
      if (inventory.posted) {
        if (!inventory.duplicate) summary.postedToInventory += 1;
      } else if (inventory.status === 'NOT_APPLICABLE') {
        summary.inventorySkipped += 1;
      } else {
        summary.inventoryPending += 1;
        summary.warnings.push(
          `recordId ${record.recordId} scale ${record.scaleNo}: ${inventory.message}`,
        );
      }
    } catch (error) {
      const message = String(error?.message || error).slice(0, 1000);
      result.code = error?.code || 'RECORD_PROCESSING_FAILED';
      result.message = message;
      if (document) {
        result.accepted = true;
        result.retryable = false;
        result.inventoryStatus = 'FAILED';
        summary.inventoryPending += 1;
        summary.warnings.push(`recordId ${result.recordId}: ${message}`);
        console.warn('[gateway:inventory-failed]', JSON.stringify({
          gatewayId: String(gatewayId),
          batchId: String(batch._id),
          recordId: result.recordId,
          productionId: String(document._id),
          code: result.code,
          message,
        }));
      } else {
        summary.failed += 1;
        summary.errors.push(`recordId ${result.recordId || 'unknown'}: ${message}`);
        console.error('[gateway:record-rejected]', JSON.stringify({
          gatewayId: String(gatewayId),
          batchId: String(batch._id),
          recordId: result.recordId,
          code: result.code,
          message,
        }));
      }
    }
  }

  const accepted = summary.recordResults.filter(row => row.accepted).length;
  const status = accepted === 0
    ? 'FAILED'
    : (summary.failed || summary.inventoryPending ? 'PARTIAL' : 'PROCESSED');
  await GatewayIngestBatch.updateOne(
    { _id: batch._id },
    { $set: { processingStatus: status, processingSummary: summary } },
  );
  console.info('[gateway:batch-completed]', JSON.stringify({
    gatewayId: String(gatewayId),
    clientBatchId,
    batchId: String(batch._id),
    status,
    received: summary.received,
    inserted: summary.inserted,
    duplicates: summary.duplicates,
    postedToInventory: summary.postedToInventory,
    inventoryPending: summary.inventoryPending,
    failed: summary.failed,
  }));
  if (Object.values(campaignSummary).some(Boolean)) {
    const updated = await Campaign.updateOne(
      { _id: campaign._id, companyId, status: 'RUNNING' },
      {
        $inc: {
          totalBlanketRollsProduced: campaignSummary.blanketRolls,
          totalBulkKgProduced: campaignSummary.bulkKg,
          totalFiberProduced: campaignSummary.fiberKg,
          totalGoodFiberProduced: campaignSummary.goodFiberKg,
          totalRejectedFiber: campaignSummary.rejectedFiberKg,
        },
      },
    );
    if (!updated.matchedCount) {
      throw new AppError('Running Campaign disappeared during gateway processing', {
        statusCode: 409,
        code: 'CAMPAIGN_CHANGED',
      });
    }
  }
  return {
    ok: true,
    gatewayId: String(gatewayId),
    batchId: batch._id,
    status,
    summary,
    recordResults: summary.recordResults,
  };
}

export async function reconcilePendingGatewayInventory({ limit = 100 } = {}) {
  const documents = await ProductionBlanketRoll.find({
    inventoryV2Posted: false,
    $or: [
      { inventoryV2Status: { $in: ['PENDING_MAPPING', 'FAILED'] } },
      { inventoryV2Status: { $exists: false } },
    ],
  })
    .sort({ at: 1, _id: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .lean();
  const summary = { scanned: documents.length, posted: 0, pending: 0, failed: 0 };
  const warehouseByCompany = new Map();
  for (const document of documents) {
    const companyKey = String(document.companyId);
    if (!warehouseByCompany.has(companyKey)) {
      warehouseByCompany.set(
        companyKey,
        await resolveGatewayWarehouseId(document.companyId),
      );
    }
    try {
      const result = await postAndLinkGatewayInventory({
        document,
        warehouseId: warehouseByCompany.get(companyKey),
      });
      if (result.posted) summary.posted += 1;
      else if (result.status === 'FAILED') summary.failed += 1;
      else summary.pending += 1;
    } catch (error) {
      await ProductionBlanketRoll.updateOne(
        { _id: document._id, inventoryV2Posted: false },
        {
          $set: {
            inventoryV2Status: 'FAILED',
            inventoryV2LastError: String(error?.message || error).slice(0, 1000),
          },
        },
      );
      summary.failed += 1;
    }
  }
  return summary;
}
