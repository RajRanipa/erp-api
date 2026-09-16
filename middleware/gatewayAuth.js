import crypto from 'crypto';
import { sendError } from '../utils/apiResponse.js';

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const gatewayAuth = (req, res, next) => {
  const configuredKey = process.env.GATEWAY_KEY;
  const context = {
    gatewayId: String(req.get('X-Gateway-ID') || req.body?.gatewayId || 'unknown'),
    requestId: req.requestId || null,
    ip: req.ip || req.socket?.remoteAddress || null,
  };
  if (!configuredKey) {
    console.error('[gateway:auth-not-configured]', JSON.stringify(context));
    return sendError(res, {
      statusCode: 503,
      code: 'GATEWAY_NOT_CONFIGURED',
      message: 'Gateway authentication is not configured.',
    });
  }

  if (!safeEqual(req.get('X-Gateway-Key'), configuredKey)) {
    console.warn('[gateway:auth-failed]', JSON.stringify(context));
    return sendError(res, {
      statusCode: 401,
      code: 'GATEWAY_UNAUTHORIZED',
      message: 'Gateway authentication failed.',
    });
  }

  console.info('[gateway:auth-ok]', JSON.stringify(context));
  return next();
};
