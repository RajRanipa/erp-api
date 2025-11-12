import jwt from 'jsonwebtoken';
import Permission from '../models/Permission.js';

// authMiddleware file here
const auth = (req, res, next) => {
  const token = req.cookies.accessToken;
  // // console.log("authMiddleware file here ")
  // // console.log(!token)

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
    console.log('Required:', required, 'Allowed ?:', ok ? 'yes' : 'no');

    if (!ok) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  } catch (e) {
    return res.status(500).json({ message: 'Auth error', error: e?.message || String(e) });
  }
};

export default auth;


 const olodroleAuth = (...requiredPerms) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized: No user context found.' });
  }
  const user = req.user;
  const allowed = rolePermissions[user.role] || [];

  // Owner bypass: full access
  // if (user.role === 'owner') {
  //   return next();
  // }

  // Normalize required permissions into a flat array
  const required = Array.isArray(requiredPerms) ? requiredPerms.flat() : [];
  // If the wrapper was called with a single array, e.g., roleAuth(['items:read'])
  // Next.js/Express will pass it as [ ['items:read'] ]; .flat() handles it.

  // Helper to check a single permission with :full implication
  const hasPermission = (perm) => {
    if (allowed.includes(perm)) return true;
    
    const required = String(perm).split(':');
    const l = required.length
    if(l >= 3 && allowed.includes(`${required[0]}:${required[l-1]}`)) return true;
    
    const [resource, action] = required;
    if (resource && allowed.includes(`${resource}:full`)) return true;
    return false;
  };

  const ok = required.length === 0 ? true : required.every(hasPermission);

  // Debug logs (optional)
  // console.log('[RBAC] user:', { id: user.id || user._id, role: user.role });
  // // console.log('[RBAC] required:', required);
  // // console.log('[RBAC] allowed:', allowed);
  // // console.log('[RBAC] decision:', ok );
  // console.log('[RBAC] decision:', ok ? 'ALLOW' : 'DENY', ' / [RBAC] required:', required);

  if (!ok) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};