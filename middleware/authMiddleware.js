import jwt from 'jsonwebtoken';
import { permissionImplies, resolveAccessContext } from '../services/accessControlService.js';

const auth = async (req, res, next) => {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({
      status: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const context = await resolveAccessContext({
      userId: decoded.userId,
      companyId: decoded.companyId || null,
    });

    if (!context?.user) {
      return res.status(401).json({ status: false, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (context.user.status !== 'active') {
      return res.status(403).json({ status: false, code: 'ACCOUNT_INACTIVE', message: 'This account is not active.' });
    }
    if (!context.user.isVerified) {
      return res.status(403).json({ status: false, code: 'EMAIL_UNVERIFIED', message: 'Email verification is required.' });
    }
    if (Number(decoded.tokenVersion || 0) !== Number(context.user.tokenVersion || 0)) {
      return res.status(401).json({ status: false, code: 'SESSION_REVOKED', message: 'This session has been revoked.' });
    }
    if (context.companyId && (!context.membership || context.membership.status !== 'active')) {
      return res.status(403).json({
        status: false,
        code: 'MEMBERSHIP_INACTIVE',
        message: 'Your membership in this company is not active.',
      });
    }
    if (
      context.membership
      && Number(decoded.membershipVersion || 0) !== Number(context.membership.accessVersion || 0)
    ) {
      return res.status(401).json({
        status: false,
        code: 'MEMBERSHIP_SESSION_REVOKED',
        message: 'Company access changed. Please log in again.',
      });
    }

    req.user = {
      userId: String(context.user._id),
      email: context.user.email,
      fullName: context.user.fullName,
      companyId: context.companyId ? String(context.companyId) : null,
      membershipId: context.membership?._id ? String(context.membership._id) : null,
      roleId: context.role?._id ? String(context.role._id) : null,
      role: context.roleKey,
      roleName: context.role?.name || context.roleKey,
      roleRank: context.role?.rank || (context.isOwner ? 100 : 0),
      isOwner: context.isOwner,
      permissions: context.permissions,
      tokenVersion: context.user.tokenVersion || 0,
      isSetupCompleted: Boolean(context.user.isSetupCompleted),
    };
    req.authContext = context;
    return next();
  } catch (error) {
    const expired = error?.name === 'TokenExpiredError';
    return res.status(expired ? 401 : 403).json({
      status: false,
      code: expired ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID',
      message: expired ? 'Your session has expired.' : 'The access token is invalid.',
    });
  }
};

export const roleAuth = (...requiredPerms) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      status: false,
      code: 'AUTH_CONTEXT_MISSING',
      message: 'Authentication must run before authorization.',
    });
  }

  if (req.user.isOwner) return next();

  const required = requiredPerms.flat().filter(Boolean);
  const allowed = new Set(req.user.permissions || []);
  const authorized = required.length === 0
    || required.every((permission) => permissionImplies(allowed, permission));

  if (!authorized) {
    return res.status(403).json({
      status: false,
      code: 'INSUFFICIENT_PERMISSION',
      message: 'You do not have permission to perform this action.',
      required,
    });
  }

  return next();
};

export default auth;
