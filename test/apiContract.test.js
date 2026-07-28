import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
} from '../utils/apiResponse.js';
import { AppError, normalizeError } from '../utils/errorHandler.js';

test('API success responses use one stable envelope for raw lists', () => {
  const response = buildSuccessEnvelope([{ id: 1 }], {
    statusCode: 200,
    requestId: 'request-123',
    timestamp: '2026-01-01T00:00:00.000Z',
  });

  assert.deepEqual(response, {
    apiVersion: '1.0',
    success: true,
    status: true,
    statusCode: 200,
    message: null,
    data: [{ id: 1 }],
    meta: null,
    error: null,
    requestId: 'request-123',
    timestamp: '2026-01-01T00:00:00.000Z',
  });
});

test('API success responses move pagination and summaries into meta', () => {
  const response = buildSuccessEnvelope({
    status: true,
    message: 'Loaded.',
    data: [{ id: 1 }],
    pagination: { page: 1, total: 10 },
    summary: { active: 8 },
  });

  assert.deepEqual(response.data, [{ id: 1 }]);
  assert.deepEqual(response.meta, {
    pagination: { page: 1, total: 10 },
    summary: { active: 8 },
  });
  assert.equal(response.message, 'Loaded.');
});

test('API success responses preserve domain workflow status values', () => {
  const envelope = buildSuccessEnvelope({
    _id: 'item-1',
    name: 'ET',
    status: 'draft',
  });

  assert.equal(envelope.success, true);
  assert.equal(envelope.status, true);
  assert.equal(envelope.data.status, 'draft');
});

test('API error responses never mix error details with success data', () => {
  const response = buildErrorEnvelope({
    message: 'Validation failed.',
    code: 'VALIDATION_ERROR',
    errors: [{ field: 'name', message: 'Name is required.' }],
  }, {
    statusCode: 400,
    requestId: 'request-456',
  });

  assert.equal(response.success, false);
  assert.equal(response.statusCode, 400);
  assert.equal(response.data, null);
  assert.equal(response.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(response.error.details, [
    { field: 'name', message: 'Name is required.' },
  ]);
});

test('central error normalization preserves operational status and codes', () => {
  const normalized = normalizeError(new AppError('Not allowed.', {
    statusCode: 403,
    code: 'FORBIDDEN',
  }));

  assert.equal(normalized.statusCode, 403);
  assert.equal(normalized.code, 'FORBIDDEN');
  assert.equal(normalized.message, 'Not allowed.');
});
