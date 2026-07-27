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
  if (!configuredKey) {
    return sendError(res, {
      statusCode: 503,
      code: 'GATEWAY_NOT_CONFIGURED',
      message: 'Gateway authentication is not configured.',
    });
  }

  if (!safeEqual(req.get('X-Gateway-Key'), configuredKey)) {
    return sendError(res, {
      statusCode: 401,
      code: 'GATEWAY_UNAUTHORIZED',
      message: 'Gateway authentication failed.',
    });
  }

  return next();
};
