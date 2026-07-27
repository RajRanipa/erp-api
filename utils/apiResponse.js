const API_VERSION = '1.0';
const INTERNAL_ENVELOPE_MARKER = Symbol.for('orient.erp.api-envelope');

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const isPlainObject = (value) =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && !Buffer.isBuffer(value);

const mergeMeta = (...values) => {
  const merged = Object.assign(
    {},
    ...values.filter((value) => isPlainObject(value))
  );
  return Object.keys(merged).length > 0 ? merged : null;
};

const successPayload = (payload) => {
  if (!isPlainObject(payload)) {
    return { data: payload ?? null, message: null, meta: null };
  }

  const {
    status: _legacyStatus,
    success: _legacySuccess,
    status_code: _legacyStatusCode,
    statusCode: _statusCode,
    message = null,
    code: _code,
    error: _error,
    errors: _errors,
    details: _details,
    meta: suppliedMeta,
    pagination,
    summary,
    ...content
  } = payload;

  if (hasOwn(payload, 'data')) {
    const { data, ...additional } = content;
    return {
      data: data ?? null,
      message,
      meta: mergeMeta(suppliedMeta, pagination ? { pagination } : null, summary ? { summary } : null, additional),
    };
  }

  return {
    data: content,
    message,
    meta: mergeMeta(suppliedMeta, pagination ? { pagination } : null, summary ? { summary } : null),
  };
};

const errorPayload = (payload) => {
  if (!isPlainObject(payload)) {
    return {
      message: typeof payload === 'string' ? payload : 'Request failed.',
      code: 'REQUEST_ERROR',
      details: null,
      meta: null,
    };
  }

  const details = payload.details
    ?? payload.errors
    ?? payload.missing
    ?? payload.required
    ?? null;

  return {
    message: payload.message || 'Request failed.',
    code: payload.code || 'REQUEST_ERROR',
    details,
    meta: mergeMeta(payload.meta),
  };
};

export const isApiEnvelope = (payload) =>
  Boolean(payload?.[INTERNAL_ENVELOPE_MARKER] || payload?.apiVersion === API_VERSION);

export function buildSuccessEnvelope(payload, {
  statusCode = 200,
  requestId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  if (isApiEnvelope(payload)) return payload;
  const normalized = successPayload(payload);

  return {
    apiVersion: API_VERSION,
    success: true,
    status: true,
    statusCode,
    message: normalized.message,
    data: normalized.data,
    meta: normalized.meta,
    error: null,
    requestId,
    timestamp,
  };
}

export function buildErrorEnvelope(payload, {
  statusCode = 500,
  requestId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  if (isApiEnvelope(payload)) return payload;
  const normalized = errorPayload(payload);

  return {
    apiVersion: API_VERSION,
    success: false,
    status: false,
    statusCode,
    message: normalized.message,
    data: null,
    meta: normalized.meta,
    error: {
      code: normalized.code,
      details: normalized.details,
    },
    requestId,
    timestamp,
  };
}

const markEnvelope = (envelope) => {
  Object.defineProperty(envelope, INTERNAL_ENVELOPE_MARKER, {
    value: true,
    enumerable: false,
  });
  return envelope;
};

export function sendSuccess(res, {
  data = null,
  message = null,
  meta = null,
  statusCode = 200,
} = {}) {
  const envelope = markEnvelope(buildSuccessEnvelope(
    { data, message, meta },
    { statusCode, requestId: res.locals?.requestId }
  ));
  return res.status(statusCode).json(envelope);
}

export function sendCreated(res, options = {}) {
  return sendSuccess(res, { ...options, statusCode: 201 });
}

export function sendError(res, {
  message = 'Request failed.',
  code = 'REQUEST_ERROR',
  details = null,
  meta = null,
  statusCode = 500,
} = {}) {
  const envelope = markEnvelope(buildErrorEnvelope(
    { message, code, details, meta },
    { statusCode, requestId: res.locals?.requestId }
  ));
  return res.status(statusCode).json(envelope);
}

export const API_RESPONSE_VERSION = API_VERSION;
