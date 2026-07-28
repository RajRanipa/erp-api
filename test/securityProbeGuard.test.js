import assert from 'node:assert/strict';
import test from 'node:test';
import { isSensitiveProbePath } from '../middleware/securityProbeGuard.js';

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
