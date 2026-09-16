import express from 'express';
import { publicSerialTrace } from '../services/inventoryV2Service.js';
import { rateLimit } from '../middleware/rateLimitMiddleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { handleError } from '../utils/errorHandler.js';

const router = express.Router();
const traceRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'Too many serial lookups. Please try again later.',
});

router.get('/trace/:serialNo', traceRateLimit, async (req, res) => {
  try {
    console.log("req.params.serialNo", req.params.serialNo );
    return sendSuccess(res, {
      data: await publicSerialTrace(req.params.serialNo),
      message: 'Verified inventory serial',
    });
  } catch (error) {
    return handleError(res, error, req);
  }
});

export default router;
