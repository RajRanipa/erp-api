import jwt from 'jsonwebtoken';
import Permission from '../models/Permission.js';

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
  // console.log("Generating Access Token for user:", user);
  const permKeys = await Permission.distinct('key', { roles: user?.role });

  const payload = {
    userId: user._id || user.id,
    companyId: user.companyId || null,
    role: user.role || 'employee',
    isSetupCompleted: user.isSetupCompleted || false,
    permissions: Array.isArray(permKeys) ? permKeys : [],
  };
  // console.log("generateAccessToken payload -> ", payload)
  const newToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
  // console.log("generateAccessToken newToken -> ", newToken)
  return newToken
};

// Generate refresh token (long-lived)
export const generateRefreshToken = (user) => {
  // console.log("Generating Refresh Token for user:", 'user =');
  return jwt.sign(
    { id: user._id || user.id, email: user.email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_TOKEN_EXPIRE_DAYS}d` }
  );
};