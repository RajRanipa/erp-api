import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Company from '../models/Company.js';
import RefreshToken from '../models/RefreshToken.js';
import User from '../models/User.js';
import { resolveAccessContext } from '../services/accessControlService.js';
import { AppError, handleError } from '../utils/errorHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  ACCESS_TOKEN_EXPIRE_MINUTES,
  REFRESH_TOKEN_EXPIRE_DAYS,
  generateAccessToken,
  generateRefreshToken,
} from '../utils/tokenUtils.js';

const GATEWAY_DEVICE = 'gateway';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeDevice = (value) =>
  String(value || GATEWAY_DEVICE).trim().toLowerCase().slice(0, 80);

const bearerToken = (req) => {
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
};

const assertActiveUser = (user) => {
  if (!user) {
    throw new AppError('Invalid credentials.', {
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  }
  if (user.status !== 'active') {
    throw new AppError('The gateway account is not active.', {
      statusCode: 403,
      code: 'ACCOUNT_INACTIVE',
    });
  }
  if (!user.isVerified) {
    throw new AppError('The gateway account email is not verified.', {
      statusCode: 403,
      code: 'EMAIL_UNVERIFIED',
    });
  }
};

async function companySetupStatus(user) {
  if (!user.companyId) return false;
  const company = await Company.findById(user.companyId)
    .select('isSetupCompleted')
    .lean();
  return Boolean(company?.isSetupCompleted);
}

async function issueGatewaySession(req, user, device) {
  const context = await resolveAccessContext({
    userId: user._id,
    companyId: user.companyId || null,
  });
  if (!context) {
    throw new AppError('Unable to resolve gateway access.', {
      statusCode: 403,
      code: 'GATEWAY_ACCESS_UNAVAILABLE',
    });
  }
  if (context.companyId && context.membership?.status !== 'active') {
    throw new AppError('The gateway company membership is not active.', {
      statusCode: 403,
      code: 'MEMBERSHIP_INACTIVE',
    });
  }

  const isSetupCompleted = await companySetupStatus(user);
  const tokenSource = {
    _id: user._id,
    companyId: context.companyId,
    membershipId: context.membership?._id || null,
    membershipVersion: context.membership?.accessVersion || 0,
    tokenVersion: user.tokenVersion || 0,
    isSetupCompleted,
  };
  const accessToken = await generateAccessToken(tokenSource);
  const refreshToken = generateRefreshToken(tokenSource);
  const refreshClaims = jwt.decode(refreshToken);
  const refreshTokenExpireAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000
  );

  await RefreshToken.create({
    userId: user._id,
    companyId: context.companyId,
    membershipId: context.membership?._id || null,
    tokenVersion: user.tokenVersion || 0,
    sessionId: refreshClaims.sessionId,
    token: refreshToken,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    expiresAt: refreshTokenExpireAt,
    device,
  });

  return {
    tokenType: 'Bearer',
    accessToken,
    refreshToken,
    accessTokenExpireAt: Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
    refreshTokenExpireAt: refreshTokenExpireAt.getTime(),
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: context.roleKey,
      companyId: context.companyId || null,
    },
  };
}

async function resolveRefreshSession(req, device) {
  const suppliedToken = String(req.body?.refreshToken || bearerToken(req) || '').trim();
  let refreshClaims = null;

  if (suppliedToken) {
    try {
      refreshClaims = jwt.verify(suppliedToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      refreshClaims = null;
    }
  }

  if (refreshClaims?.type === 'refresh' && refreshClaims.userId) {
    const session = await RefreshToken.findMatchingToken(
      suppliedToken,
      refreshClaims.userId
    );
    if (
      session
      && session.sessionId === refreshClaims.sessionId
      && session.expiresAt > new Date()
      && session.device === device
    ) {
      return {
        session,
        userId: String(refreshClaims.userId),
        legacy: false,
      };
    }
  }

  // Temporary compatibility for installed gateway clients that still send the
  // expired access token plus userId. X-Gateway-Key authentication is required.
  const legacyUserId = String(req.body?.userId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(legacyUserId)) {
    throw new AppError('A valid refresh token is required.', {
      statusCode: 401,
      code: 'GATEWAY_REFRESH_INVALID',
    });
  }

  const session = await RefreshToken.findOne({
    userId: legacyUserId,
    device,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!session) {
    throw new AppError('The gateway session is invalid or expired.', {
      statusCode: 401,
      code: 'GATEWAY_SESSION_EXPIRED',
    });
  }

  return { session, userId: legacyUserId, legacy: true };
}

export async function gateWayLogin(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const device = normalizeDevice(req.body?.device);

    if (!email || !password) {
      throw new AppError('Email and password are required.', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid credentials.', {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }
    assertActiveUser(user);

    await User.updateOne(
      { _id: user._id },
      { $set: { lastSeenAt: new Date() } }
    );
    const session = await issueGatewaySession(req, user, device);

    return sendSuccess(res, {
      message: 'Gateway login successful.',
      data: session,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function gateWayRefreshToken(req, res) {
  try {
    const device = normalizeDevice(req.body?.device);
    const current = await resolveRefreshSession(req, device);
    const user = await User.findById(current.userId);
    assertActiveUser(user);

    if (Number(current.session.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      throw new AppError('The gateway session has been revoked.', {
        statusCode: 401,
        code: 'GATEWAY_SESSION_REVOKED',
      });
    }

    await RefreshToken.deleteOne({ _id: current.session._id });
    const session = await issueGatewaySession(req, user, device);

    return sendSuccess(res, {
      message: 'Gateway access token refreshed.',
      data: session,
      meta: current.legacy
        ? {
            deprecation: 'Send data.refreshToken as refreshToken on the next refresh request.',
          }
        : null,
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}

export async function gateWayLogout(req, res) {
  try {
    const device = normalizeDevice(req.body?.device);
    const suppliedToken = String(req.body?.refreshToken || bearerToken(req) || '').trim();
    let result;

    if (suppliedToken) {
      let claims = null;
      try {
        claims = jwt.verify(suppliedToken, process.env.JWT_REFRESH_SECRET);
      } catch {
        claims = null;
      }
      if (!claims?.userId) {
        throw new AppError('A valid refresh token is required.', {
          statusCode: 401,
          code: 'GATEWAY_REFRESH_INVALID',
        });
      }
      const hashedToken = RefreshToken.hashToken(suppliedToken);
      result = await RefreshToken.deleteOne({
        token: hashedToken,
        userId: claims.userId,
        device,
      });
    } else {
      const userId = String(req.body?.userId || '').trim();
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new AppError('userId is required.', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        });
      }
      result = await RefreshToken.deleteMany({ userId, device });
    }

    return sendSuccess(res, {
      message: 'Gateway logged out successfully.',
      data: { sessionsRevoked: result.deletedCount || 0 },
    });
  } catch (error) {
    return handleError(res, error, req);
  }
}
