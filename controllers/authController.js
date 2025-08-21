import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';
import RefreshToken from '../models/RefreshToken.js';
import { error } from 'console';

const ACCESS_TOKEN_EXPIRE_MINUTES = 15;
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

// @desc    Register new user
// @route   POST /signup
// @access  Public
export async function signup(req, res) {
  try {
    const { fullName, email, password } = req.body;
    console.log(" signup hit _ ")
    console.log(fullName, email, password)
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ status: false, message: 'Email already exists' });
    }

    // Create user with hashed password
    const newUser = await User.create({ fullName, email, password }); // No manual hash

    const accessToken = generateAccessToken(newUser._id);
    const refreshToken = generateRefreshToken(newUser);

    const refreshTokenExpireAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      userId: newUser._id,
      token: refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: refreshTokenExpireAt,
    });

    console.log("NODE_ENV : ", process.env.NODE_ENV, process.env.NODE_ENV === 'production')

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      status: true,
      message: 'User registered successfully',
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        email: newUser.email,
      }
    });
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({
      status: false,
      message: 'Server error during signup',
    });
  }
};

// @desc    Login user
// @route   POST /login
// @access  Public
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    console.log("hit the log in ", email, password)
    // Find user and explicitly select password
    const user = await User.findOne({ email }).select('+password');
    // console.log("user ", user)
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    // console.log("isMatch ", isMatch)
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user);
    console.log("refreshToken ", refreshToken)

    const refreshTokenExpireAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    const accessTokenExpireAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000);

    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: refreshTokenExpireAt,
    });

    // console.log("Domain_Name : ", process.env.Domain_Name, process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,)

    
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000, 
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      status: true,
      message: 'Login successful',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        companyId: user.companyId || null,
      },
      accessTokenExpireAt
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({
      status: false,
      message: 'Server error during login',
    });
  }
};

// @desc    Refresh access token
// @route   POST /refresh-token
// @access  Public (uses HttpOnly cookie)
export async function refreshToken(req, res) {
  console.log("Attempting to refresh token..");
  const token = req.cookies.refreshToken;
  const aToken = req.cookies.accessToken;
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
  console.log("refreshToken token at refreshToken ::-- ", timestamp, token, !aToken);

  if (!token) {
    console.error("No refresh token found.");
    return res.status(401).json({ status: false, message: 'No refresh token found' });
  }

  try {
    console.log("Verifying refresh token...");
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    console.log("Refresh token decoded:", decoded );
    console.log("Refresh token :", token);

    // ✅ Use model method to find matching hashed token
    const existingToken = await RefreshToken.findMatchingToken(token, decoded.id);
    if (!existingToken) {
      console.error("No matching refresh token found in database.");
      return res.status(403).json({ status: false, message: 'Invalid refresh token' });
    }

    // ❌ Delete old toke
    console.log("Deleting old refresh token from database.");
    await RefreshToken.deleteOne({ _id: existingToken._id });

    // ✅ Generate new tokens
    const user = await User.findById(decoded.id);
    if (!user) {
      console.error("User not found for decoded refresh token.");
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Generate tokens with shorter expiry for testing
    console.log("Generating new access and refresh tokens with short expiry for testing.");
    const accessToken = generateAccessToken(user._id); // 1 minute expiry
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
    console.log("Setting new cookies for access and refresh tokens.");
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

    console.log("Token refresh successful, returning response.");

    // 📅 Calculate and send the new access token expiry time
    const accessTokenExpireAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000);
    return res.status(200).json({ 
      status: true, 
      message: 'Access token refreshed',
      accessTokenExpireAt
    });
  } catch (err) {
    console.error('Refresh Token Error:', err);
    return res.status(403).json({ status: false, message: 'Invalid or expired refresh token' });
  }
};

export async function checkAuth(req, res) {
  const token = req.cookies.accessToken; // Get access token from cookies
  console.log("accessToken token at checkAuth :- ", !req.cookies.accessToken) // i am geeting this token here 
  console.log("refreshToken token at checkAuth :- ", !req.cookies.refreshToken) // i am geeting this token here
  if (!token) {
    return res.status(401).json({
      status: false,
      message: 'No access token found, user not authenticated.'
    });
  }

  try {
    // Verify the access token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Fetch user preferences
    const user = await User.findById(decoded.id).select('preferences role');
    if (!user) {
      return res.status(404).json({
        status: false,
        message: 'User not found.',
      });
    }

    // Attach the decoded user info to the request object for further use if needed
    console.log("decoded at checkAuth :- ", decoded)

    res.status(200).json({
      status: true,
      user: {
        id: req.user.id,
        preferences: user.preferences,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({
      status: false,
      message: 'Invalid or expired access token.'
    });
  }
};

// @desc    Logout user
// @route   POST /logout
// @access  Public (cookies will be cleared)
export function logout(req, res) {
  // Clear cookies for both accessToken and refreshToken
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.Strict_Mode,
    domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
  });
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.Strict_Mode,
    domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
  });

  // Send response confirming the logout
  res.status(200).json({ status: true, message: 'Successfully logged out' });
};
//

export async function changePreferences(req, res) {
  const userId = req.user?.id;
  const { theme, language, notifications } = req.body;
  console.log("req.user", req.user.id) // this is undefine becuse middleware set req.user to this json { iat: 1745828714, exp: 1745829614 }
  if (!userId) {
    return res.status(401).json({ status: false, message: 'Unauthorized: No user found in request.' });
  }

  // Basic validation
  if (!['light', 'dark', 'system'].includes(theme)) {
    return res.status(400).json({ status: false, message: 'Invalid theme selected.' });
  }
  if (!['en', 'hi'].includes(language)) {
    return res.status(400).json({ status: false, message: 'Invalid language selected.' });
  }
  if (typeof notifications?.emailUpdates !== 'boolean' || typeof notifications?.inAppAlerts !== 'boolean') {
    return res.status(400).json({ status: false, message: 'Invalid notifications settings.' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        'preferences.theme': theme,
        'preferences.language': language,
        'preferences.notifications': notifications
      },
      { new: true, runValidators: true }
    );
    console.log("Updated user preferences:", user);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    return res.status(200).json({
      status: true,
      message: 'Preferences updated successfully.',
      preferences: user.preferences,
    });
  } catch (error) {
    console.error('Preferences update error:', error);
    return res.status(500).json({ status: false, message: 'Server error while updating preferences.' });
  }
};