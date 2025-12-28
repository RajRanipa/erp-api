// controllers/gatewayProductionController.js
import { ingestBlanketBatch } from "../services/gatewayProductionService.js";

export async function ingestBlanketProduction(req, res) {
  try {
    const companyId = process.env.GATEWAY_COMPANY_ID;
    if (!companyId) {
      throw new Error("GATEWAY_COMPANY_ID not configured");
    }

    const result = await ingestBlanketBatch({
      companyId,
      payload: req.body,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Gateway ingest error:", err);
    return res.status(400).json({ message: err.message });
  }
}