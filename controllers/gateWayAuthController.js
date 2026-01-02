// backend-api/controllers/authController.js
import User from '../models/User.js';
import Company from '../models/Company.js';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS } from '../utils/tokenUtils.js';
import RefreshToken from '../models/RefreshToken.js';
import { handleError } from '../utils/errorHandler.js';


const APP_NAME = process.env.APP_NAME || 'Orient ERP';

process.env.CLIENT_URL


export async function gateWayLogin(req, res) {
  try {
    const { email, password } = req.body;

    console.log("hit the log in ===================, email", email)
    // Find user and explicitly select password
    const user = await User.findOne({ email }).select('+password');
    // console.log("user ", user)
    if (!user) {
      return res.status(400).json({ status: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    // console.log("isMatch ", isMatch)
    if (!isMatch) {
      return res.status(400).json({ status: false, message: 'Invalid credentials' });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        message: 'Your account has been disabled. Contact admin.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        message: 'Your account has been suspended. Contact admin.',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: 'Email not verified. Please verify your email.',
        requiresVerification: true,
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        message: 'Your account is not active. Contact admin.',
      });
    }

    // Optional: update last seen timestamp
    user.lastSeenAt = new Date();
    await user.save({ validateBeforeSave: false });

    // after password check and before token generation
    // derive company/setup values (do NOT mutate DB unless you mean to persist)
    const companyId = user.companyId || null;

    // If you track isSetupCompleted on Company, fetch it. If you store on user, fallback:
    let isSetupCompleted = !!user.isSetupCompleted; // boolean

    // Prefer authoritative source: if you have a Company model, fetch company setup status
    if (companyId) {
      const company = await Company.findById(companyId).select('isSetupCompleted').lean();
      isSetupCompleted = !!(company && company.isSetupCompleted);
    } else {
      isSetupCompleted = false; // no company => setup not complete
    }

    // console.log('login payload values -> ');

    // now generate tokens using a payload object (not the raw user doc)
    const tokenPayload = {
      id: String(user._id),
      companyId,
      role: user.role,
      isSetupCompleted
    };
    // console.log("tokenPayload ", tokenPayload);
    // return;
    const accessToken = await generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(user);
    // console.log("refreshToken ", refreshToken)

    const refreshTokenExpireAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    const accessTokenExpireAt = Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000;

    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: refreshTokenExpireAt,
      device: 'gateway',
    });

    console.log('Login successful');
    // console.log('res.cookie from login ', req.cookies);
    res.status(200).json({
      status: true,
      message: 'Login successful',
      "data": {
        tokenType: "Bearer",
        accessToken,
        accessTokenExpireAt,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          companyId: user.companyId || null,
        },
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    return handleError(res, error);
  }
};

export async function gateWayRefreshToken(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  console.log("Attempting to refresh token..", authHeader);
  
  const { device, userId } = req.body;
  console.log("response body", device,userId);
  
  const now = new Date();
  const timestamp = now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  console.log("refreshToken token at refreshToken ::-- ", timestamp, token);

  if (!token) {
    console.error("No refresh token found.");
    return res.status(401).json({ status: false, message: 'No refresh token found' });
  }

  try {
    // console.log("Verifying refresh token...");
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log("Verified refresh token.", decoded);
    
    // ✅ Use model method to find matching hashed token
    const existingToken = await RefreshToken.findMatchingToken(device, decoded.userId || userId);
    if (!existingToken) {
      console.error("No matching refresh token found in database.");
      return res.status(403).json({ status: false, message: 'Invalid refresh token' });
    }

    // ❌ Delete old toke
    // console.log("Deleting old refresh token from database.");
    await RefreshToken.deleteOne({ _id: existingToken._id });

    // ✅ Generate new tokens
    const user = await User.findById(decoded.userId);
    if (!user) {
      console.error("User not found for decoded refresh token.");
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Generate tokens with shorter expiry for testing
    // console.log("Generating new access and refresh tokens with short expiry for testing. user = ", user);
    const accessToken = await generateAccessToken(user); // when we send this user there should be isSetupCompleted key 
    const newRefreshToken = generateRefreshToken(user); // 2 minutes expiry

    const refreshTokenExpireAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      userId: user._id,
      token: newRefreshToken, // ⚠ Model should auto-hash this
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: refreshTokenExpireAt,
    });

    // ✅ Set cookies againn
    // console.log("Setting new cookies for access and refresh tokens.");
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
    });

    console.log("Token refresh successful, returning response.", timestamp);

    // 📅 Calculate and send the new access token expiry time
    const accessTokenExpireAt = Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000;

    return res.status(200).json({
      status: true,
      message: 'Access token refreshed',
      accessTokenExpireAt: accessTokenExpireAt
    });
  } catch (err) {
    console.error('Refresh Token Error:', err);
    return res.status(403).json({ status: false, message: 'Invalid or expired refresh token' });
  }
};