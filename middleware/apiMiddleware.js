import crypto from 'crypto';
import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
  isApiEnvelope,
} from '../utils/apiResponse.js';

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

const resolveRequestId = (req) => {
  const supplied = String(req.get('X-Request-ID') || '').trim();
  return requestIdPattern.test(supplied) ? supplied : crypto.randomUUID();
};

export function apiContext(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId = resolveRequestId(req);

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Cache-Control', 'no-store');

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (res.headersSent) return originalJson(payload);

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    res.setHeader('Server-Timing', `app;dur=${elapsedMs.toFixed(2)}`);

    if (isApiEnvelope(payload)) {
      return originalJson(payload);
    }

    const options = {
      statusCode: res.statusCode,
      requestId,
    };
    const envelope = res.statusCode >= 400
      ? buildErrorEnvelope(payload, options)
      : buildSuccessEnvelope(payload, options);

    return originalJson(envelope);
  };

  next();
}

export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
