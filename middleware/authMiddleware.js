import jwt from 'jsonwebtoken';
import { rolePermissions } from '../config/rolePermissions.js';

// authMiddleware file here
const auth = (req, res, next) => {
  const token = req.cookies.accessToken;
  // console.log("authMiddleware file here ")
  // console.log(!token)

  if (!token) {
    console.log(" authMiddleware file here false ")
    return res.status(401).json({ message: 'Unauthorized: No access token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log("Decoded of Middleware")
    console.log(decoded)
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Forbidden: Invalid or expired access token.' });
  }
};

// Role-based access control middleware
export const rolekkAuth = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: No user context found.' });
    }

    const { role } = req.user;
    if (!role) {
      return res.status(403).json({ message: 'Forbidden: No role assigned to user.' });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ message: `Forbidden: Requires role ${allowedRoles.join(', ')}` });
    }

    next();
  };
};

export default auth;


export const roleAuth = (...requiredPerms) => (req, res, next) => {
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
    const [resource, action] = String(perm).split(':');
    if (resource && allowed.includes(`${resource}:full`)) return true;
    return false;
  };

  const ok = required.length === 0 ? true : required.every(hasPermission);

  // Debug logs (optional)
  console.log('[RBAC] user:', { id: user.id || user._id, role: user.role });
  console.log('[RBAC] required:', required);
  console.log('[RBAC] allowed:', allowed);
  console.log('[RBAC] decision:', ok );
  console.log('[RBAC] decision:', ok ? 'ALLOW' : 'DENY');

  if (!ok) {
    return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  }
  next();
};