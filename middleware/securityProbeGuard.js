import { sendError } from '../utils/apiResponse.js';

const EXACT_PROBE_FILES = new Set([
  '.gitlab-ci.yml',
  '.gitlab-ci.yaml',
  '.drone.yml',
  '.drone.yaml',
  '.travis.yml',
  '.travis.yaml',
  '.azure-pipelines.yml',
  '.azure-pipelines.yaml',
  'jenkinsfile',
  'bitbucket-pipelines.yml',
  'bitbucket-pipelines.yaml',
  'azure-pipelines.yml',
  'azure-pipelines.yaml',
  'appveyor.yml',
  'appveyor.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'dockerfile',
  'makefile',
  'procfile',
  'app.yml',
  'app.yaml',
]);

const SENSITIVE_DOT_SEGMENTS = new Set([
  '.aws',
  '.buildkite',
  '.circleci',
  '.docker',
  '.env',
  '.git',
  '.github',
  '.gitlab',
  '.hg',
  '.idea',
  '.ssh',
  '.svn',
  '.vscode',
]);

const SENSITIVE_FILE_SUFFIX = /\.(?:bak|dump|key|pem|sql|sqlite|sqlite3|swp)$/i;
const COMPOSE_MANIFEST = /^(?:docker-)?compose(?:\.[a-z0-9_-]+)*\.ya?ml$/i;
const DOCKERFILE_VARIANT = /^dockerfile(?:\.[a-z0-9_-]+)*$/i;

function safelyDecodePath(value) {
  let decoded = String(value || '').split('?')[0];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.replaceAll('\\', '/').replace(/\/+/g, '/');
}

export function isSensitiveProbePath(value) {
  const pathname = safelyDecodePath(value).toLowerCase();
  if (!pathname || pathname === '/') return false;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some(segment => (
    SENSITIVE_DOT_SEGMENTS.has(segment)
    || segment.startsWith('.env.')
  ))) return true;
  const fileName = segments.at(-1) || '';
  return EXACT_PROBE_FILES.has(fileName)
    || COMPOSE_MANIFEST.test(fileName)
    || DOCKERFILE_VARIANT.test(fileName)
    || SENSITIVE_FILE_SUFFIX.test(fileName);
}

/**
 * Public servers are constantly scanned for CI files, repository metadata,
 * environment files, and backups. Return the same generic 404 for every probe
 * without passing it through application error logging.
 */
export function securityProbeGuard(req, res, next) {
  if (!isSensitiveProbePath(req.originalUrl || req.url)) return next();

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return sendError(res, {
    statusCode: 404,
    code: 'RESOURCE_NOT_FOUND',
    message: 'Resource not found.',
  });
}

export default securityProbeGuard;
