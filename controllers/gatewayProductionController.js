import { ingestBlanketBatch } from "../services/gatewayProductionService.js";
import { AppError, handleError } from "../utils/errorHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

export async function ingestBlanketProduction(req, res) {
  const gatewayId = String(req.body?.gatewayId || req.get('X-Gateway-ID') || 'unknown');
  const clientBatchId = String(req.body?.clientBatchId || req.get('X-Idempotency-Key') || 'unknown');
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  console.info('[gateway:received]', JSON.stringify({
    gatewayId,
    clientBatchId,
    records: records.length,
    recordIds: records.map(record => String(record?.recordId || 'unknown')),
    requestId: req.requestId || null,
  }));
  try {
    const companyId = process.env.GATEWAY_COMPANY_ID;
    if (!companyId) {
      throw new AppError("Gateway company is not configured.", {
        statusCode: 503,
        code: "GATEWAY_NOT_CONFIGURED",
      });
    }

    const result = await ingestBlanketBatch({
      companyId,
      payload: req.body,
    });

    console.info('[gateway:processed]', JSON.stringify({
      gatewayId,
      clientBatchId,
      batchId: String(result.batchId),
      status: result.status,
      inserted: result.summary?.inserted || 0,
      duplicates: result.summary?.duplicates || 0,
      postedToInventory: result.summary?.postedToInventory || 0,
      inventoryPending: result.summary?.inventoryPending || 0,
      failed: result.summary?.failed || 0,
    }));

    return sendSuccess(res, {
      message: "Gateway production batch processed.",
      data: result,
    });
  } catch (err) {
    console.error('[gateway:failed]', JSON.stringify({
      gatewayId,
      clientBatchId,
      records: records.length,
      code: err?.code || 'GATEWAY_REQUEST_FAILED',
      message: String(err?.message || err),
      requestId: req.requestId || null,
    }));
    return handleError(res, err, req);
  }
}
