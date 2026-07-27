import { ingestBlanketBatch } from "../services/gatewayProductionService.js";
import { AppError, handleError } from "../utils/errorHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

export async function ingestBlanketProduction(req, res) {
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

    return sendSuccess(res, {
      message: "Gateway production batch processed.",
      data: result,
    });
  } catch (err) {
    return handleError(res, err, req);
  }
}
