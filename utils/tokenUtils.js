import jwt from 'jsonwebtoken';

// Generate access token (short-lived)
export const generateAccessToken = (user) => {
  console.log("user._id at generateAccessToken");
  console.log("user :- ", user);
  console.log("user.id :- ", user._id);
  return jwt.sign(
    { id: user._id ? user._id : user },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
};

// Generate refresh token (long-lived)
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};
