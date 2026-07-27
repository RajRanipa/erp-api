import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { resolveAccessContext } from '../services/accessControlService.js';

export const ACCESS_TOKEN_EXPIRE_MINUTES = 15;
export const REFRESH_TOKEN_EXPIRE_DAYS = 7;

// Generate access token (short-lived)
// export const generateAccessToken = (user) => {
//   // console.log("Generating Access Token for user:", user);
//   return jwt.sign(
//     { id: user._id ? user._id : user },
//     process.env.JWT_ACCESS_SECRET,
//     { expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m` }
//   );
// };

export const generateAccessToken = async (user) => {
  const userId = user?._id || user?.id || user?.userId;
  const context = await resolveAccessContext({
    userId,
    companyId: user?.companyId || null,
  });
  if (!context) throw new Error('Cannot generate token for an unknown user');

  const payload = {
    userId: context.user._id,
    companyId: context.companyId || null,
    membershipId: context.membership?._id || null,
    membershipVersion: context.membership?.accessVersion || 0,
    roleId: context.role?._id || null,
    role: context.roleKey,
    isOwner: context.isOwner,
    tokenVersion: context.user.tokenVersion || 0,
    isSetupCompleted: user?.isSetupCompleted ?? context.user.isSetupCompleted ?? false,
    permissions: context.permissions,
  };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
};

// Generate refresh token (long-lived)
export const generateRefreshToken = (user) => {
  const sessionId = crypto.randomUUID();
  return jwt.sign(
    {
      userId: user._id || user.id || user.userId,
      companyId: user.companyId || null,
      membershipId: user.membershipId || null,
      membershipVersion: user.membershipVersion || 0,
      tokenVersion: user.tokenVersion || 0,
      sessionId,
      type: 'refresh',
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_TOKEN_EXPIRE_DAYS}d` }
  );
};
