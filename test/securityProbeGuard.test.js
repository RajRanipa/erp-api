import assert from 'node:assert/strict';
import test from 'node:test';
import { isSensitiveProbePath } from '../middleware/securityProbeGuard.js';
import { notFoundHandler } from '../utils/errorHandler.js';

test('recognizes common CI/CD and repository reconnaissance paths', () => {
  for (const path of [
    '/.circleci/config.yaml',
    '/.gitlab-ci.yml',
    '/.gitlab-ci.yaml',
    '/Jenkinsfile',
    '/jenkinsfile',
    '/.drone.yml',
    '/.drone.yaml',
    '/bitbucket-pipelines.yml',
    '/bitbucket-pipelines.yaml',
    '/.git/config',
    '/.env.production',
    '/backup/database.sql',
    '/%2e%67%69%74/config',
    '/.travis.yaml',
    '/docker-compose.prod.yml',
    '/docker-compose.production.yml',
    '/docker-compose.override.yml',
    '/Dockerfile',
    '/Dockerfile.production',
    '/.buildkite/pipeline.yml',
    '/.buildkite/pipeline.yaml',
    '/Makefile',
    '/Procfile',
    '/app.yaml',
    '/.azure-pipelines.yml',
  ]) {
    assert.equal(isSensitiveProbePath(path), true, path);
  }
});

test('does not intercept legitimate ERP, webhook, or well-known routes', () => {
  for (const path of [
    '/',
    '/api/procurement/orders',
    '/api/items/options',
    '/gateway/blanket/production',
    '/webhook',
    '/.well-known/acme-challenge/token',
    '/uploads/invoice.pdf',
  ]) {
    assert.equal(isSensitiveProbePath(path), false, path);
  }
});

test('ordinary unmatched routes return a standard 404 without error middleware', () => {
  const req = {
    method: 'GET',
    originalUrl: '/unknown-public-path',
  };
  const response = {
    locals: { requestId: 'test-request-id' },
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };

  const result = notFoundHandler(req, response);

  assert.equal(result, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  assert.equal(response.body.message, 'Route not found.');
  assert.equal(response.body.requestId, 'test-request-id');
});
