import jwt from 'jsonwebtoken';
import Permission from '../models/Permission.js';

// authMiddleware file here
const auth = (req, res, next) => {
  const token = req.cookies.accessToken;
  // console.log("authMiddleware file here ")
  // console.log("method:", req.method);
  console.log("res.req.url", res.req.url)
  console.log("res.req.originalUrl", res.req.originalUrl)
  // console.log(next)
  // console.log("token",!token)
  // console.log(new Error("Middleware trace").stack);
  if (!token) {
    // console.log(" authMiddleware file here false ")
    return res.status(401).json({ message: 'Unauthorized: No access token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    // // console.log("Decoded of Middleware")
    // // console.log(decoded)
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Forbidden: Invalid or expired access token.' });
  }
};

// Simple in-memory cache for role permissions
const __permCache = new Map(); // role -> { keys: Set<string>, ts: number }
const PERM_CACHE_TTL_MS = 60 * 1000; // 60s

async function getPermissionsForRole(role) {
  const now = Date.now();
  const hit = __permCache.get(role);
  if (hit && now - hit.ts < PERM_CACHE_TTL_MS) return hit.keys;
  // Fetch from DB using the Permission model
  const keys = await Permission.getKeysForRole?.(role) ?? [];
  const asSet = new Set(keys);
  __permCache.set(role, { keys: asSet, ts: now });
  return asSet;
}

export const roleAuth = (...requiredPerms) => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: No user context found.' });
    }
    const user = req.user;
    const role = user.role;

    // Owner bypass (full access)
    if (role === 'owner') {
      return next();
    }

    // Normalize required permissions into a flat array
    const required = Array.isArray(requiredPerms) ? requiredPerms.flat() : [];
    // Load allowed permissions for this role from DB (cached)
    const allowedSet = await getPermissionsForRole(role);

    // Helper to check a single permission with implied :full and flexible segment support
    const hasPermission = (perm) => {
      if (!perm) return false;
      if (allowedSet.has(perm)) return true;
      const parts = String(perm).split(':').filter(Boolean);
      const resource = parts[0];
      if (allowedSet.has(`${resource}:full`)) return true;
      return false;
    };

    const ok = required.length === 0 ? true : required.every(hasPermission);
    // console.log('Required:', required, 'Allowed ?:', ok ? 'yes' : 'no');

    if (!ok) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  } catch (e) {
    return res.status(500).json({ message: 'Auth error', error: e?.message || String(e) });
  }
};

export default auth;
