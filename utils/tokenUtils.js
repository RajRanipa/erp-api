import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_EXPIRE_MINUTES = 15;
export const REFRESH_TOKEN_EXPIRE_DAYS = 7;

// Generate access token (short-lived)
// export const generateAccessToken = (user) => {
//   console.log("Generating Access Token for user:", user);
//   return jwt.sign(
//     { id: user._id ? user._id : user },
//     process.env.JWT_ACCESS_SECRET,
//     { expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m` }
//   );
// };

export const generateAccessToken = (user) => {
  console.log("Generating Access Token for user:", user);

  const payload = {
    id: user._id || user.id,
    companyId: user.companyId || null,
    role: user.role || 'employee',
    isSetupCompleted: user.isSetupCompleted || false,
  };

  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
};

// Generate refresh token (long-lived)
export const generateRefreshToken = (user) => {
  console.log("Generating Refresh Token for user:", 'user =');
  return jwt.sign(
    { id: user._id || user.id, email: user.email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_TOKEN_EXPIRE_DAYS}d` }
  );
};