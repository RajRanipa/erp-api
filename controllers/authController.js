// backend-api/controllers/authController.js
import User from '../models/User.js';
import Company from '../models/Company.js';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS } from '../utils/tokenUtils.js';
import RefreshToken from '../models/RefreshToken.js';
import { handleError } from '../utils/errorHandler.js';
import Permission from '../models/Permission.js';
import SignupOtp from '../models/SignupOtp.js';

import sendMail from '../utils/sendMail.js';

const APP_NAME = process.env.APP_NAME || 'Orient ERP';

process.env.CLIENT_URL

// Helper to generate 6-digit numeric OTP
function generateSixDigitOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Build HTML content for signup/login OTP email
function buildSignupOtpEmailHtml({ email, otp, mode = 'signup' }) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@example.com';
  const fromName = process.env.MAIL_FROM_NAME || APP_NAME;
  const brandColor = '#2563eb'; // Tailwind blue-600
  const textColor = '#111827'; // gray-900
  const mutedText = '#6b7280'; // gray-500
  const borderColor = '#e5e7eb'; // gray-200
  const bgColor = '#f9fafb'; // gray-50
  const APP_URL = process.env.CLIENT_URL || 'https://erp.orientfibertech.com/';
  // console.log('APP_URL', APP_URL) // https://erp.orientfibertech.com/
  const isLogin = mode === 'login';

  const title = isLogin
    ? 'Login to your account'
    : 'Verify your email address';

  const subtitle = isLogin
    ? `Hi there, we received a request to log in to your ${APP_NAME} account using this email address. Please use the one-time verification code below to continue.`
    : `Hi there, we just received a request to create a new ${APP_NAME} account with this email address. Please use the one-time verification code below to continue.`;

  const buttonHref = isLogin ? `${APP_URL}/login` : `${APP_URL}/signup`;
  const buttonLabel = isLogin ? 'Open dashboard' : 'Continue signup';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <title>${fromName} - Email Verification</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* Basic reset */
      body {
        margin: 0;
        padding: 0;
        background-color: ${bgColor};
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: ${textColor};
      }
      a {
        color: ${brandColor};
        text-decoration: none;
      }
      .container {
        width: 100%;
        background-color: ${bgColor};
        padding: 24px 0;
      }
      .card {
        max-width: 480px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 12px;
        border: 1px solid ${borderColor};
        box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
        padding: 24px 24px 20px;
      }
      .brand {
        font-size: 18px;
        font-weight: 700;
        color: ${brandColor};
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .title {
        font-size: 20px;
        margin-top: 12px;
        margin-bottom: 4px;
        font-weight: 600;
      }
      .subtitle {
        font-size: 14px;
        color: ${mutedText};
        margin: 0 0 16px;
      }
      .otp-box {
        margin: 20px 0;
        padding: 14px 16px;
        background-color: #eff6ff;
        border-radius: 10px;
        border: 1px dashed ${brandColor};
        text-align: center;
      }
      .otp-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: ${mutedText};
        margin-bottom: 4px;
      }
      .otp-code {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 0.30em;
        color: ${brandColor};
      }
      .button-wrapper {
        text-align: center;
        margin: 16px 0 8px;
      }
      .button {
        display: inline-block;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: 600;
        border-radius: 999px;
        background: linear-gradient(135deg, ${brandColor}, #1d4ed8);
        color: #ffffff !important;
      }
      .meta {
        font-size: 12px;
        color: ${mutedText};
        margin: 8px 0;
      }
      .divider {
        height: 1px;
        margin: 16px 0;
        background-color: ${borderColor};
      }
      .footer {
        font-size: 11px;
        color: ${mutedText};
        text-align: center;
        margin-top: 12px;
      }
      .muted {
        color: ${mutedText};
      }
      .email-tag {
        display: inline-block;
        margin-top: 4px;
        padding: 4px 8px;
        border-radius: 999px;
        background-color: #f3f4f6;
        font-size: 11px;
        color: ${mutedText};
      }
      @media (prefers-color-scheme: dark) {
        body {
          background-color: #020617;
          color: #e5e7eb;
        }
        .card {
          background-color: #020617;
          border-color: #1f2937;
          box-shadow: 0 10px 30px rgba(0,0,0,0.75);
        }
        .subtitle,
        .meta,
        .footer,
        .muted,
        .email-tag {
          color: #9ca3af;
        }
        .email-tag {
          background-color: #111827;
        }
        .divider {
          background-color: #1f2937;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="brand">${fromName}</div>
        <h1 class="title">${title}</h1>
        <p class="subtitle">
          ${subtitle}
        </p>
        <div class="otp-box">
          <div class="otp-label">Your verification code</div>
          <div class="otp-code">${otp}</div>
        </div>
        <div class="button-wrapper">
          <a href="${buttonHref}" class="button" target="_blank" rel="noreferrer">
            ${buttonLabel}
          </a>
        </div>
        <p class="meta">
          This code will expire in <strong>10 minutes</strong>. For your security, please do not share this
          code with anyone.
        </p>
        <p class="meta">
          This email was sent to:
          <span class="email-tag">${email}</span>
        </p>
        <div class="divider"></div>
        <p class="footer">
          If you did not request this, you can safely ignore this email.
          If you have any questions, reply to this email or contact us at
          <a href="mailto:${supportEmail}">${supportEmail}</a>.
        </p>
        <p class="footer muted">
          &copy; ${new Date().getFullYear()} ${fromName}. All rights reserved.
        </p>
      </div>
    </div>
  </body>
</html>`;
}

// @desc    Start signup flow: check if email exists, if not generate & send OTP
// @route   POST /signup/start
// @access  Public

export async function signupStart(req, res) {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      // Email already registered → tell frontend to redirect to login
      return res.status(200).json({
        status: true,
        message: 'Email already registered. Redirect to login.',
        data: { exists: true },
      });
    }

    // Email does NOT exist → generate OTP and store in DB
    const otp = generateSixDigitOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otp,
        expiresAt,
        verified: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // console.log(
    //   "normalizedEmail: " + normalizedEmail + ", otp: " + otp + ", expiresAt: " + expiresAt,
    //   `${APP_NAME} verification code`,
    //    buildSignupOtpEmailHtml({ email: normalizedEmail, otp }),
    // )
    // return;
    // Send real OTP email via SendGrid helper
    try {
      await sendMail({
        to: normalizedEmail,
        subject: `${APP_NAME} verification code`,
        html: buildSignupOtpEmailHtml({ email: normalizedEmail, otp, mode: 'signup' }),
      });

      // Optional: still log for local debugging
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[SIGNUP OTP:DB] email=${normalizedEmail}, otp=${otp}, expiresAt=${expiresAt.toISOString()}`
        );
      }
    } catch (mailErr) {
      console.error('Error sending signup OTP email:', mailErr);
      return res.status(500).json({
        status: false,
        message: 'Failed to send verification email. Please try again later.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Signup OTP generated and sent.',
      data: { exists: false },
    });
  } catch (error) {
    console.error('SignupStart Error:', error);
    return handleError(res, error);
  }
}

// @desc    Verify signup OTP for a new email
// @route   POST /signup/verify-otp
// @access  Public
export async function signupVerifyOtp(req, res) {
  try {
    // console.log(' signupVerifyOtp hit _ ');
    const { email, otp } = req.body || {};

    if (!email || !otp) {
      return res.status(400).json({ status: false, message: 'Email and OTP are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedOtp = String(otp).trim();

    const record = await SignupOtp.findOne({ email: normalizedEmail });

    if (!record) {
      return res.status(400).json({
        status: false,
        message: 'No OTP found. Please start signup again.',
      });
    }

    const now = new Date();
    if (record.expiresAt < now) {
      await SignupOtp.deleteOne({ _id: record._id });
      return res.status(400).json({
        status: false,
        message: 'OTP expired. Please request a new one.',
      });
    }

    if (record.otp !== trimmedOtp) {
      return res.status(400).json({
        status: false,
        message: 'Invalid OTP. Please try again.',
      });
    }

    // Mark as verified; let TTL index clean it up later
    record.verified = true;
    await record.save();

    return res.status(200).json({
      status: true,
      message: 'OTP verified successfully.',
      data: { verified: true },
    });
  } catch (error) {
    console.error('SignupVerifyOtp Error:', error);
    return handleError(res, error);
  }
}

// @desc    Resend signup OTP for a new email
// @route   POST /signup/resend-otp
// @access  Public
export async function signupResendOtp(req, res) {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Safety: if user got created in between for some reason, block resend
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: 'Email already registered. Please login instead.',
      });
    }

    const otp = generateSixDigitOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otp,
        expiresAt,
        verified: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendMail({
        to: normalizedEmail,
        subject: `${APP_NAME} verification code (new OTP)`,
        html: buildSignupOtpEmailHtml({ email: normalizedEmail, otp, mode: 'signup' }),
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[SIGNUP OTP RESEND:DB] email=${normalizedEmail}, otp=${otp}, expiresAt=${expiresAt.toISOString()}`
        );
      }
    } catch (mailErr) {
      console.error('Error sending signup RESEND OTP email:', mailErr);
      return res.status(500).json({
        status: false,
        message: 'Failed to resend verification email. Please try again later.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'New signup OTP generated and sent.',
    });
  } catch (error) {
    console.error('SignupResendOtp Error:', error);
    return handleError(res, error);
  }
}

// @desc    Start login with OTP flow for existing user
// @route   POST /login/start-otp
// @access  Public
export async function loginStartOtp(req, res) {
  try {
    console.log(' loginStartOtp hit _ ');
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // For security, avoid revealing whether email exists
      return res.status(400).json({
        status: false,
        message: 'Invalid login request',
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been disabled. Contact admin.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been suspended. Contact admin.',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        status: false,
        message: 'Email not verified. Please verify your email before using OTP login.',
      });
    }

    const otp = generateSixDigitOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otp,
        expiresAt,
        verified: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendMail({
        to: normalizedEmail,
        subject: `${APP_NAME} login verification code`,
        html: buildSignupOtpEmailHtml({ email: normalizedEmail, otp, mode: 'login' }),
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[LOGIN OTP:DB] email=${normalizedEmail}, otp=${otp}, expiresAt=${expiresAt.toISOString()}`
        );
      }
    } catch (mailErr) {
      console.error('Error sending login OTP email:', mailErr);
      return res.status(500).json({
        status: false,
        message: 'Failed to send login verification email. Please try again later.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Login OTP generated and sent.',
    });
  } catch (error) {
    console.error('loginStartOtp Error:', error);
    return handleError(res, error);
  }
}

// @desc    Verify login OTP and log user in
// @route   POST /login/verify-otp
// @access  Public
export async function loginVerifyOtp(req, res) {
  try {
    const { email, otp } = req.body || {};

    if (!email || !otp) {
      return res.status(400).json({ status: false, message: 'Email and OTP are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedOtp = String(otp).trim();

    const record = await SignupOtp.findOne({ email: normalizedEmail });

    if (!record) {
      return res.status(400).json({
        status: false,
        message: 'No OTP found. Please request a new code.',
      });
    }

    const now = new Date();
    if (record.expiresAt < now) {
      await SignupOtp.deleteOne({ _id: record._id });
      return res.status(400).json({
        status: false,
        message: 'OTP expired. Please request a new one.',
      });
    }

    if (record.otp !== trimmedOtp) {
      return res.status(400).json({
        status: false,
        message: 'Invalid OTP. Please try again.',
      });
    }

    // OTP is valid, proceed to login flow (same checks as password login)
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ status: false, message: 'Invalid credentials' });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been disabled. Contact admin.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been suspended. Contact admin.',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        status: false,
        message: 'Email not verified. Please verify your email.',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        status: false,
        message: 'Your account is not active. Contact admin.',
      });
    }

    // Optional: update last seen timestamp
    user.lastSeenAt = new Date();
    await user.save({ validateBeforeSave: false });

    // derive company/setup values
    const companyId = user.companyId || null;
    let isSetupCompleted = !!user.isSetupCompleted;

    if (companyId) {
      const company = await Company.findById(companyId).select('isSetupCompleted').lean();
      isSetupCompleted = !!(company && company.isSetupCompleted);
    } else {
      isSetupCompleted = false;
    }

    const tokenPayload = {
      id: String(user._id),
      companyId,
      role: user.role,
      isSetupCompleted,
    };

    const accessToken = await generateAccessToken(tokenPayload);
    const refreshTokenVal = generateRefreshToken(user);

    const refreshTokenExpireAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000
    );
    const accessTokenExpireAt = Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000;

    await RefreshToken.create({
      userId: user._id,
      token: refreshTokenVal,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      expiresAt: refreshTokenExpireAt,
    });

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });

    res.cookie('refreshToken', refreshTokenVal, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.Strict_Mode,
      domain: process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,
      maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
    });

    // OTP consumed; delete record
    await SignupOtp.deleteOne({ _id: record._id });

    console.log('Login via OTP successful');
    return res.status(200).json({
      status: true,
      message: 'Login successful',
      accessTokenExpireAt,
    });
  } catch (error) {
    console.error('loginVerifyOtp Error:', error);
    return handleError(res, error);
  }
}

// @desc    Resend login OTP
// @route   POST /login/resend-otp
// @access  Public
export async function loginResendOtp(req, res) {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ status: false, message: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({
        status: false,
        message: 'Invalid login request',
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been disabled. Contact admin.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        status: false,
        message: 'Your account has been suspended. Contact admin.',
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        status: false,
        message: 'Email not verified. Please verify your email before using OTP login.',
      });
    }

    const otp = generateSixDigitOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otp,
        expiresAt,
        verified: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendMail({
        to: normalizedEmail,
        subject: `${APP_NAME} login verification code (new OTP)`,
        html: buildSignupOtpEmailHtml({ email: normalizedEmail, otp, mode: 'login' }),
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[LOGIN OTP RESEND:DB] email=${normalizedEmail}, otp=${otp}, expiresAt=${expiresAt.toISOString()}`
        );
      }
    } catch (mailErr) {
      console.error('Error sending login RESEND OTP email:', mailErr);
      return res.status(500).json({
        status: false,
        message: 'Failed to resend login verification email. Please try again later.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'New login OTP generated and sent.',
    });
  } catch (error) {
    console.error('loginResendOtp Error:', error);
    return handleError(res, error);
  }
}

// @desc    Register new user
// @route   POST /signup
// @access  Public
export async function signup(req, res) {
  try {
    const { fullName, email, password } = req.body;
    console.log(" signup hit _ ")
    // Enforce that email has a verified signup OTP before allowing account creation
    const normalizedEmail = String(email).trim().toLowerCase();
    const otpRecord = await SignupOtp.findOne({ email: normalizedEmail });

    if (!otpRecord || !otpRecord.verified) {
      return res.status(400).json({
        status: false,
        message: 'Email not verified via OTP. Please complete email verification first.',
      });
    }
    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ status: false, message: 'Email already exists' });
    }

    // Create user with hashed password
    const newUser = await User.create({
      fullName,
      email: normalizedEmail,
      password,
      role: 'owner',
      status: 'active'
    }); // No manual hash
    // Clean up the OTP record now that the user is created
    await SignupOtp.deleteOne({ _id: otpRecord._id });

    return res.status(201).json({
      status: true,
      message: 'User registered successfully. Please log in.',
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        email: newUser.email,
      }
    });
  } catch (error) {
    console.error('Signup Error:', error);
    return handleError(res, error);
  }
};

// @desc    Login user
// @route   POST /login
// @access  Public
export async function login(req, res) {
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
    });

    // console.log("Domain_Name : ", process.env.Domain_Name, process.env.Domain_Name.includes('localhost') ? '' : process.env.Domain_Name,)
    // console.log('accessToken from login ', accessToken);
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

    console.log('Login successful');
    // console.log('res.cookie from login ', req.cookies);
    res.status(200).json({
      status: true,
      message: 'Login successful',
      // user: {
      //   id: user._id,
      //   fullName: user.fullName,
      //   email: user.email,
      //   role: user.role,
      //   companyId: user.companyId || null,
      //   isSetupCompleted
      // },
      accessTokenExpireAt: accessTokenExpireAt
    });
  } catch (error) {
    console.error('Login Error:', error);
    return handleError(res, error);
  }
};

// @desc    Refresh access token
// @route   POST /refresh-token
// @access  Public (uses HttpOnly cookie)
export async function refreshToken(req, res) {
  // console.log("Attempting to refresh token..");
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
  // console.log("refreshToken token at refreshToken ::-- ", timestamp, token, !aToken);

  if (!token) {
    console.error("No refresh token found.");
    return res.status(401).json({ status: false, message: 'No refresh token found' });
  }

  try {
    // console.log("Verifying refresh token...");
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    // console.log("Verified refresh token.", decoded);
    // ✅ Use model method to find matching hashed token
    const existingToken = await RefreshToken.findMatchingToken(token, decoded.userId);
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

export async function checkAuth(req, res) {
  console.log("Attempting to check auth..");
  const token = req.cookies.accessToken; // Get access token from cookies
  // console.log("req.cookies ", req.cookies);
  // console.log("req.cookies.accessToken ", req.cookies.accessToken);
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
    const user = await User.findById(decoded.userId).populate('companyId','companyName');
    if (!user) {
      return res.status(404).json({
        status: false,
        message: 'User not found.',
      });
    }

    // Attach the decoded user info to the request object for further use if needed
    // Fetch permissions from Permission collection for this role
    let permKeys = [];
    try {
      // Use distinct for efficient key extraction
      permKeys = await Permission.distinct('key', { roles: user.role });
    } catch (e) {
      console.error('Failed to load permissions for role', user.role, e);
      permKeys = [];
    }
    res.status(200).json({
      status: true,
      user: {
        userId: user._id,
        userName: user.fullName,
        companyName: user?.companyId?.companyName || null,
        email: user.email,
        role: user.role,
        companyId: user?.companyId?._id || null,
        isSetupCompleted: user?.isSetupCompleted || false,
        permissions: permKeys,
      },
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
// @desc    Logout user
// @route   POST /logout
// @access  Public (cookies will be cleared)
export async function logout(req, res) {
  // Try to revoke the specific refresh token record first (best effort)
  try {
    const raw = req.cookies?.refreshToken;
    if (raw) {
      try {
        const decoded = jwt.verify(raw, process.env.JWT_REFRESH_SECRET);
        // Find the exact stored token using your model helper (hash-aware)
        const existing = await RefreshToken.findMatchingToken(raw, decoded.userId);
        if (existing) {
          await RefreshToken.deleteOne({ _id: existing._id });
        }
      } catch (e) {
        // token may be expired/invalid — still proceed to clear cookies
      }
    }
  } catch (e) {
    // don’t block logout on DB issues
    console.error('Logout revoke error:', e);
  }

  // Build cookie options that EXACTLY match how you set them
  const baseCookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',       // if sameSite:'none', secure MUST be true
    sameSite: process.env.SAME_SITE || 'lax',            // 'lax' | 'strict' | 'none'
    path: '/',                                          // match the default path used on set
  };

  // Only set domain when you actually have a non-localhost domain
  const domain = process.env.Domain_Name;
  if (domain && !domain.includes('localhost')) {
    baseCookie.domain = domain;
  }

  // Overwrite with empty value + 0 maxAge (or expires in the past)
  res.cookie('accessToken', '', { ...baseCookie, maxAge: 0 });
  res.cookie('refreshToken', '', { ...baseCookie, maxAge: 0 });

  return res.status(200).json({ status: true, message: 'Successfully logged out' });
}

// @route POST /logout-all
export async function logoutAll(req, res) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ status: false, message: 'Unauthorized' });

    await RefreshToken.deleteMany({ userId });

    const baseCookie = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.SAME_SITE || 'lax',
      path: '/',
    };
    const domain = process.env.Domain_Name;
    if (domain && !domain.includes('localhost')) baseCookie.domain = domain;

    res.cookie('accessToken', '', { ...baseCookie, maxAge: 0 });
    res.cookie('refreshToken', '', { ...baseCookie, maxAge: 0 });

    return res.status(200).json({ status: true, message: 'Logged out from all devices' });
  } catch (err) {
    console.error('Logout all error:', err);
    return res.status(500).json({ status: false, message: 'Server error during logout all' });
  }
} 

export async function changePassword(req, res) {
  try {
    const actingUser = req.user;
    if (!actingUser?.userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ status: false, message: 'Current and new password are required' });
    }

    const user = await User.findById(actingUser.userId).select('+password +tokenVersion');

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Verify current password
    let isMatch = false;

    if (typeof user.comparePassword === 'function') {
      isMatch = await user.comparePassword(currentPassword);
    } else {
      // fallback: use bcrypt if comparePassword is not defined
      // isMatch = await bcrypt.compare(currentPassword, user.password);
      throw new Error('Password comparison method not implemented');
    }

    if (!isMatch) {
      return res
        .status(400)
        .json({ status: false, message: 'Current password is incorrect' });
    }

    // Set new password (pre-save hook should hash it)
    user.password = newPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Invalidate refresh tokens so all sessions are logged out
    try {
      await RefreshToken.deleteMany({ userId: user._id });
    } catch (err) {
      console.error('changePassword RefreshToken delete error:', err);
      // not fatal, we already changed the password
    }

    return res.json({
      status: true,
      message: 'Password updated successfully. Please log in again on other devices.',
    });
  } catch (err) {
    console.error('changePassword error:', err);
    return res
      .status(500)
      .json({ status: false, message: 'Failed to update password' });
  }
}