import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Company from '../models/Company.js';
import SignupOtp from '../models/SignupOtp.js';
import RefreshToken from '../models/RefreshToken.js';
import Membership from '../models/Membership.js';
import sendMail from '../utils/sendMail.js';
import {
  ACCESS_TOKEN_EXPIRE_MINUTES,
  REFRESH_TOKEN_EXPIRE_DAYS,
  generateAccessToken,
  generateRefreshToken,
} from '../utils/tokenUtils.js';
import { clearAuthCookies, setAuthCookies } from '../utils/authCookies.js';
import { resolveAccessContext } from '../services/accessControlService.js';
import { recordUserAudit } from '../utils/userAudit.js';

const APP_NAME = process.env.APP_NAME || 'JNR ERP';
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const generateOtp = () => String(crypto.randomInt(100000, 1000000));
const otpSecret = () => process.env.OTP_SECRET || process.env.JWT_REFRESH_SECRET;
const hashOtp = (email, purpose, otp) => crypto
  .createHmac('sha256', otpSecret())
  .update(`${normalizeEmail(email)}:${purpose}:${String(otp)}`)
  .digest('hex');

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordError(password) {
  const value = String(password || '');
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return 'Password must include uppercase, lowercase, and a number.';
  }
  return '';
}

async function sendOtpEmail(email, otp, purpose) {
  const purposeLabel = {
    signup: 'verify your new account',
    login: 'complete your login',
    password_reset: 'reset your password',
    email_change: 'verify your new email',
  }[purpose] || 'verify your request';

  await sendMail({
    to: email,
    subject: `${APP_NAME} verification code`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f4f4f5;padding:28px">
        <div style="max-width:520px;margin:auto;background:white;border-radius:12px;padding:28px">
          <h2>${APP_NAME}</h2>
          <p>Use this code to ${purposeLabel}:</p>
          <div style="font-size:30px;font-weight:700;letter-spacing:8px;margin:24px 0">${otp}</div>
          <p>This code expires in 10 minutes. Never share it with anyone.</p>
        </div>
      </div>`,
  });
}

async function createOtp({ email, purpose, userId = null }) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await SignupOtp.findOneAndUpdate(
    { email, purpose },
    {
      $set: {
        otpHash: hashOtp(email, purpose, otp),
        expiresAt,
        verified: false,
        attempts: 0,
        consumedAt: null,
        userId,
      },
      $inc: { resendCount: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await sendOtpEmail(email, otp, purpose);
  return expiresAt;
}

async function verifyOtp({ email, purpose, otp, consume = false }) {
  const record = await SignupOtp.findOne({ email, purpose }).select('+otpHash');
  if (!record || record.consumedAt) return { ok: false, message: 'No active verification code was found.' };
  if (record.expiresAt <= new Date()) {
    await record.deleteOne();
    return { ok: false, message: 'Verification code expired.' };
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await record.deleteOne();
    return { ok: false, message: 'Too many incorrect attempts. Request a new code.' };
  }
  if (!secureEqual(record.otpHash, hashOtp(email, purpose, otp))) {
    record.attempts += 1;
    await record.save();
    return { ok: false, message: 'Verification code is incorrect.' };
  }
  record.verified = true;
  if (consume) record.consumedAt = new Date();
  await record.save();
  return { ok: true, record };
}

function deviceLabel(userAgent = '') {
  if (/mobile|android|iphone/i.test(userAgent)) return 'Mobile device';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unknown device';
}

async function issueSession(req, res, user, { companyId = null, isSetupCompleted } = {}) {
  const context = await resolveAccessContext({
    userId: user._id,
    companyId: companyId || user.companyId || null,
  });
  if (!context) throw new Error('Unable to resolve user access.');
  if (context.companyId && context.membership?.status !== 'active') {
    const error = new Error('Your membership in this company is not active.');
    error.code = 'MEMBERSHIP_INACTIVE';
    throw error;
  }

  const tokenSource = {
    _id: user._id,
    companyId: context.companyId,
    membershipId: context.membership?._id || null,
    membershipVersion: context.membership?.accessVersion || 0,
    tokenVersion: user.tokenVersion || 0,
    isSetupCompleted: isSetupCompleted ?? user.isSetupCompleted,
  };
  const accessToken = await generateAccessToken(tokenSource);
  const refreshToken = generateRefreshToken(tokenSource);
  const decodedRefresh = jwt.decode(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId: user._id,
    companyId: context.companyId,
    membershipId: context.membership?._id || null,
    tokenVersion: user.tokenVersion || 0,
    sessionId: decodedRefresh.sessionId,
    token: refreshToken,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    device: deviceLabel(req.headers['user-agent']),
    expiresAt,
  });
  setAuthCookies(res, { accessToken, refreshToken });
  return {
    accessTokenExpireAt: Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
  };
}

async function companySetupStatus(user) {
  if (!user.companyId) return false;
  const company = await Company.findById(user.companyId).select('isSetupCompleted').lean();
  return Boolean(company?.isSetupCompleted);
}

export async function signupStart(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ status: false, message: 'A valid email is required.' });
    const exists = Boolean(await User.exists({ email }));
    if (!exists) await createOtp({ email, purpose: 'signup' });
    return res.json({ status: true, data: { exists }, message: exists ? 'Account already exists.' : 'Verification code sent.' });
  } catch (error) {
    console.error('signupStart error:', error);
    return res.status(500).json({ status: false, message: 'Unable to start signup.' });
  }
}

export const signupResendOtp = signupStart;

export async function signupVerifyOtp(req, res) {
  const email = normalizeEmail(req.body?.email);
  const result = await verifyOtp({ email, purpose: 'signup', otp: req.body?.otp });
  if (!result.ok) return res.status(400).json({ status: false, message: result.message });
  return res.json({ status: true, message: 'Email verified.' });
}

export async function signup(req, res) {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const validation = passwordError(password);
    if (fullName.length < 2 || fullName.length > 120) {
      return res.status(400).json({ status: false, message: 'Name must be between 2 and 120 characters.' });
    }
    if (validation) return res.status(400).json({ status: false, message: validation });
    const otp = await SignupOtp.findOne({ email, purpose: 'signup', verified: true, consumedAt: null });
    if (!otp || otp.expiresAt <= new Date()) {
      return res.status(400).json({ status: false, message: 'Complete email verification before signup.' });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ status: false, message: 'An account already exists for this email.' });
    }
    const user = await User.create({
      fullName,
      email,
      password,
      role: 'owner',
      status: 'active',
      isVerified: true,
    });
    otp.consumedAt = new Date();
    await otp.save();
    return res.status(201).json({
      status: true,
      message: 'Account created. Please log in.',
      user: { id: user._id, fullName: user.fullName, email: user.email },
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ status: false, message: 'Email already exists.' });
    return res.status(500).json({ status: false, message: 'Failed to create account.' });
  }
}

export async function login(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ status: false, message: 'Invalid email or password.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ status: false, message: 'This account is not active.' });
    }
    if (!user.isVerified) {
      return res.status(403).json({ status: false, message: 'Email verification is required.' });
    }
    user.lastSeenAt = new Date();
    await user.save({ validateBeforeSave: false });
    const isSetupCompleted = await companySetupStatus(user);
    const session = await issueSession(req, res, user, { isSetupCompleted });
    return res.json({ status: true, message: 'Login successful.', ...session });
  } catch (error) {
    console.error('login error:', error);
    if (error?.code === 'MEMBERSHIP_INACTIVE') {
      return res.status(403).json({ status: false, code: error.code, message: error.message });
    }
    return res.status(500).json({ status: false, message: 'Login failed.' });
  }
}

export async function loginStartOtp(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const user = await User.findOne({ email }).select('_id status isVerified');
    if (!user || user.status !== 'active' || !user.isVerified) {
      return res.status(400).json({ status: false, message: 'Unable to send a login code for this account.' });
    }
    await createOtp({ email, purpose: 'login', userId: user._id });
    return res.json({ status: true, message: 'Login code sent.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Unable to send login code.' });
  }
}

export const loginResendOtp = loginStartOtp;

export async function loginVerifyOtp(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const result = await verifyOtp({ email, purpose: 'login', otp: req.body?.otp, consume: true });
    if (!result.ok) return res.status(400).json({ status: false, message: result.message });
    const user = await User.findOne({ email });
    if (!user || user.status !== 'active' || !user.isVerified) {
      return res.status(403).json({ status: false, message: 'This account is not active.' });
    }
    user.lastSeenAt = new Date();
    await user.save({ validateBeforeSave: false });
    const session = await issueSession(req, res, user, { isSetupCompleted: await companySetupStatus(user) });
    return res.json({ status: true, message: 'Login successful.', ...session });
  } catch (error) {
    if (error?.code === 'MEMBERSHIP_INACTIVE') {
      return res.status(403).json({ status: false, code: error.code, message: error.message });
    }
    return res.status(500).json({ status: false, message: 'OTP login failed.' });
  }
}

export async function refreshToken(req, res) {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return res.status(401).json({ status: false, code: 'REFRESH_REQUIRED', message: 'Refresh token is missing.' });
  try {
    const decoded = jwt.verify(rawToken, process.env.JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');
    const stored = await RefreshToken.findMatchingToken(rawToken, decoded.userId);
    if (!stored || stored.expiresAt <= new Date() || stored.sessionId !== decoded.sessionId) {
      clearAuthCookies(res);
      return res.status(401).json({ status: false, code: 'REFRESH_INVALID', message: 'Session is no longer valid.' });
    }
    const user = await User.findById(decoded.userId);
    if (!user || user.status !== 'active' || !user.isVerified) {
      await RefreshToken.deleteOne({ _id: stored._id });
      clearAuthCookies(res);
      return res.status(403).json({ status: false, code: 'ACCOUNT_INACTIVE', message: 'Account is not active.' });
    }
    if (Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      await RefreshToken.deleteOne({ _id: stored._id });
      clearAuthCookies(res);
      return res.status(401).json({ status: false, code: 'SESSION_REVOKED', message: 'Session was revoked.' });
    }
    const context = await resolveAccessContext({
      userId: user._id,
      companyId: decoded.companyId || user.companyId,
    });
    if (context.companyId && context.membership?.status !== 'active') {
      await RefreshToken.deleteOne({ _id: stored._id });
      clearAuthCookies(res);
      return res.status(403).json({ status: false, code: 'MEMBERSHIP_INACTIVE', message: 'Membership is not active.' });
    }
    if (
      context.membership
      && Number(decoded.membershipVersion || 0) !== Number(context.membership.accessVersion || 0)
    ) {
      await RefreshToken.deleteOne({ _id: stored._id });
      clearAuthCookies(res);
      return res.status(401).json({ status: false, code: 'MEMBERSHIP_SESSION_REVOKED', message: 'Company access changed.' });
    }

    const tokenSource = {
      _id: user._id,
      companyId: context.companyId,
      membershipId: context.membership?._id || null,
      membershipVersion: context.membership?.accessVersion || 0,
      tokenVersion: user.tokenVersion || 0,
      isSetupCompleted: await companySetupStatus(user),
    };
    const accessToken = await generateAccessToken(tokenSource);
    const nextRefreshToken = generateRefreshToken(tokenSource);
    const nextDecoded = jwt.decode(nextRefreshToken);
    const nextSession = await RefreshToken.create({
      userId: user._id,
      companyId: context.companyId,
      membershipId: context.membership?._id || null,
      tokenVersion: user.tokenVersion || 0,
      sessionId: nextDecoded.sessionId,
      token: nextRefreshToken,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      device: deviceLabel(req.headers['user-agent']),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000),
    });
    await RefreshToken.deleteOne({ _id: stored._id });
    setAuthCookies(res, { accessToken, refreshToken: nextRefreshToken });
    return res.json({
      status: true,
      message: 'Session refreshed.',
      sessionId: nextSession.sessionId,
      accessTokenExpireAt: Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    });
  } catch (error) {
    clearAuthCookies(res);
    return res.status(401).json({ status: false, code: 'REFRESH_INVALID', message: 'Session is invalid or expired.' });
  }
}

export async function checkAuth(req, res) {
  const user = await User.findById(req.user.userId).select('fullName email preferences lastSeenAt').lean();
  const company = req.user.companyId
    ? await Company.findById(req.user.companyId).select('companyName isSetupCompleted enabledModules').lean()
    : null;
  return res.json({
    status: true,
    user: {
      userId: req.user.userId,
      userName: user?.fullName || '',
      email: user?.email || '',
      companyId: req.user.companyId,
      companyName: company?.companyName || '',
      membershipId: req.user.membershipId,
      roleId: req.user.roleId,
      role: req.user.role,
      roleName: req.user.roleName,
      roleRank: req.user.roleRank,
      isOwner: req.user.isOwner,
      permissions: req.user.permissions,
      enabledModules: company?.enabledModules || [],
      isSetupCompleted: company ? Boolean(company.isSetupCompleted) : false,
    },
  });
}

export async function logout(req, res) {
  try {
    const rawToken = req.cookies?.refreshToken;
    if (rawToken) {
      const decoded = jwt.verify(rawToken, process.env.JWT_REFRESH_SECRET);
      const stored = await RefreshToken.findMatchingToken(rawToken, decoded.userId);
      if (stored) await stored.deleteOne();
    }
  } catch {
    // Cookie clearing is intentionally best effort.
  }
  clearAuthCookies(res);
  return res.json({ status: true, message: 'Logged out.' });
}

export async function logoutAll(req, res) {
  await User.updateOne({ _id: req.user.userId }, { $inc: { tokenVersion: 1 } });
  await RefreshToken.deleteMany({ userId: req.user.userId });
  clearAuthCookies(res);
  await recordUserAudit(req, 'sessions.revoked_all', { targetUserId: req.user.userId });
  return res.json({ status: true, message: 'All sessions were signed out.' });
}

export async function changePassword(req, res) {
  try {
    const user = await User.findById(req.user.userId).select('+password');
    if (!user || !(await user.comparePassword(req.body?.currentPassword || ''))) {
      return res.status(400).json({ status: false, message: 'Current password is incorrect.' });
    }
    const validation = passwordError(req.body?.newPassword);
    if (validation) return res.status(400).json({ status: false, message: validation });
    if (await user.comparePassword(req.body.newPassword)) {
      return res.status(400).json({ status: false, message: 'New password must be different.' });
    }
    user.password = req.body.newPassword;
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await RefreshToken.deleteMany({ userId: user._id });
    clearAuthCookies(res);
    await recordUserAudit(req, 'password.changed', { targetUserId: user._id });
    return res.json({ status: true, reauthenticate: true, message: 'Password updated. Please log in again.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update password.' });
  }
}

export async function passwordResetStart(req, res) {
  const email = normalizeEmail(req.body?.email);
  const user = await User.findOne({ email, status: 'active' }).select('_id');
  if (user) {
    try {
      await createOtp({ email, purpose: 'password_reset', userId: user._id });
    } catch (error) {
      console.error('password reset email error:', error);
    }
  }
  return res.json({
    status: true,
    message: 'If an active account exists, a password reset code has been sent.',
  });
}

export async function passwordResetComplete(req, res) {
  const email = normalizeEmail(req.body?.email);
  const validation = passwordError(req.body?.newPassword);
  if (validation) return res.status(400).json({ status: false, message: validation });
  const result = await verifyOtp({
    email,
    purpose: 'password_reset',
    otp: req.body?.otp,
    consume: true,
  });
  if (!result.ok) return res.status(400).json({ status: false, message: result.message });
  const user = await User.findOne({ email }).select('+password');
  if (!user) return res.status(400).json({ status: false, message: 'Password reset failed.' });
  user.password = req.body.newPassword;
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await RefreshToken.deleteMany({ userId: user._id });
  return res.json({ status: true, message: 'Password reset successfully.' });
}

export async function emailChangeStart(req, res) {
  const nextEmail = normalizeEmail(req.body?.email);
  if (!EMAIL_RE.test(nextEmail)) return res.status(400).json({ status: false, message: 'A valid email is required.' });
  if (await User.exists({ email: nextEmail })) {
    return res.status(409).json({ status: false, message: 'This email is already in use.' });
  }
  const user = await User.findById(req.user.userId).select('+password');
  if (!user || !(await user.comparePassword(req.body?.currentPassword || ''))) {
    return res.status(400).json({ status: false, message: 'Current password is incorrect.' });
  }
  user.pendingEmail = nextEmail;
  await user.save({ validateBeforeSave: false });
  await createOtp({ email: nextEmail, purpose: 'email_change', userId: user._id });
  return res.json({ status: true, message: 'Verification code sent to the new email.' });
}

export async function emailChangeVerify(req, res) {
  const user = await User.findById(req.user.userId);
  if (!user?.pendingEmail) return res.status(400).json({ status: false, message: 'No email change is pending.' });
  const result = await verifyOtp({
    email: user.pendingEmail,
    purpose: 'email_change',
    otp: req.body?.otp,
    consume: true,
  });
  if (!result.ok) return res.status(400).json({ status: false, message: result.message });
  user.email = user.pendingEmail;
  user.pendingEmail = null;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await RefreshToken.deleteMany({ userId: user._id });
  clearAuthCookies(res);
  return res.json({ status: true, reauthenticate: true, message: 'Email updated. Please log in again.' });
}

export async function listSessions(req, res) {
  const sessions = await RefreshToken.find({ userId: req.user.userId, expiresAt: { $gt: new Date() } })
    .select('sessionId companyId membershipId userAgent ip device createdAt updatedAt expiresAt')
    .sort({ updatedAt: -1 })
    .lean();
  let currentSessionId = null;
  try {
    currentSessionId = jwt.verify(req.cookies?.refreshToken, process.env.JWT_REFRESH_SECRET)?.sessionId;
  } catch {
    // Access token can still be valid even if the refresh cookie is absent.
  }
  return res.json({
    status: true,
    data: sessions.map((session) => ({
      ...session,
      current: session.sessionId === currentSessionId,
    })),
  });
}

export async function revokeSession(req, res) {
  const session = await RefreshToken.findOneAndDelete({
    userId: req.user.userId,
    sessionId: req.params.sessionId,
  });
  if (!session) return res.status(404).json({ status: false, message: 'Session not found.' });
  let currentSessionId = null;
  try {
    currentSessionId = jwt.verify(req.cookies?.refreshToken, process.env.JWT_REFRESH_SECRET)?.sessionId;
  } catch {
    // Ignore.
  }
  if (currentSessionId === req.params.sessionId) clearAuthCookies(res);
  return res.json({ status: true, currentSessionRevoked: currentSessionId === req.params.sessionId, message: 'Session revoked.' });
}

export async function listMyCompanies(req, res) {
  const memberships = await Membership.find({ userId: req.user.userId, status: 'active' })
    .populate('companyId', 'companyName isSetupCompleted')
    .populate('roleId', 'key name rank isOwner')
    .sort({ isDefault: -1, createdAt: 1 })
    .lean();
  return res.json({
    status: true,
    data: memberships
      .filter((membership) => membership.companyId)
      .map((membership) => ({
        membershipId: String(membership._id),
        companyId: String(membership.companyId._id),
        companyName: membership.companyId.companyName,
        isSetupCompleted: Boolean(membership.companyId.isSetupCompleted),
        role: membership.roleId?.key,
        roleName: membership.roleId?.name,
        current: String(membership.companyId._id) === String(req.user.companyId),
      })),
  });
}

export async function switchCompany(req, res) {
  const companyId = req.body?.companyId;
  const membership = await Membership.findOne({
    userId: req.user.userId,
    companyId,
    status: 'active',
  }).populate('companyId', 'isSetupCompleted');
  if (!membership) {
    return res.status(404).json({ status: false, message: 'Active company membership not found.' });
  }
  const user = await User.findById(req.user.userId);
  const rawToken = req.cookies?.refreshToken;
  let previousSession = null;
  if (rawToken) {
    try {
      const decoded = jwt.verify(rawToken, process.env.JWT_REFRESH_SECRET);
      previousSession = await RefreshToken.findMatchingToken(rawToken, decoded.userId);
    } catch {
      // A new valid session can still be issued from the authenticated access token.
    }
  }
  const session = await issueSession(req, res, user, {
    companyId,
    isSetupCompleted: Boolean(membership.companyId?.isSetupCompleted),
  });
  if (previousSession) await RefreshToken.deleteOne({ _id: previousSession._id });
  await Membership.updateMany({ userId: user._id }, { $set: { isDefault: false } });
  await Membership.updateOne({ _id: membership._id }, { $set: { isDefault: true } });
  return res.json({ status: true, message: 'Company switched.', ...session });
}
