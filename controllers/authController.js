import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '../utils/tokenUtils.js';
import RefreshToken from '../models/RefreshToken.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';


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
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await RefreshToken.create({
      userId: newUser._id,
      token: hashedRefreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
    console.log("user ",user)
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    console.log("isMatch ",isMatch)
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user);
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await RefreshToken.create({
      userId: user._id,
      token: hashedRefreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
  const token = req.cookies.refreshToken;
  console.log("refreshToken token at refreshToken ::-- ", token, !token);

  if (!token) {
    return res.status(401).json({ status: false, message: 'No refresh token found' });
  }

  try {
    // Decode the token to get the user ID (and other data if needed)
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    console.log("Decoded token:", decoded); // Check if { id, email, iat, exp } are in the decoded payload
    // here id is still not coming after 15 min of expiring accestoken untill that id is coming 

    // Hash the refresh token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    console.log("hashedToken - ", hashedToken);

    // Check the stored refresh token in the database
    const existingToken = await RefreshToken.findOne({ token: hashedToken });
    if (!existingToken || existingToken.userId.toString() !== decoded.id) {
      return res.status(403).json({ status: false, message: 'Invalid refresh token' });
    }

    // Revoke the old refresh token
    await RefreshToken.deleteOne({ token: hashedToken });
    // Fetch user from DB first
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Now generate new tokens with full user data
    const accessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user);
    
    const hashedNewRefreshToken = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    // Store the new refresh token in the database
    await RefreshToken.create({
      userId: decoded.id,
      token: hashedNewRefreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    // Set cookies for the new tokens
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({ status: true, message: 'Access token refreshed' });
  } catch (err) {
    console.error('Refresh Token Error:', err);
    res.status(403).json({ status: false, message: 'Invalid refresh token' });
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
    req.user = decoded;
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
    sameSite: 'Strict',
  });
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
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