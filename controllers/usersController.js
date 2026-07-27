import crypto from 'crypto';
import mongoose from 'mongoose';
import Invite from '../models/Invite.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Membership from '../models/Membership.js';
import RefreshToken from '../models/RefreshToken.js';
import UserAuditLog from '../models/UserAuditLog.js';
import sendMail from '../utils/sendMail.js';
import {
  canManageRole,
  countActiveOwners,
  findCompanyRole,
  resolveAccessContext,
} from '../services/accessControlService.js';
import { recordUserAudit } from '../utils/userAudit.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const genToken = () => crypto.randomBytes(32).toString('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeInvite = (invite) => ({
  _id: String(invite._id),
  email: invite.email,
  inviteeName: invite.inviteeName || '',
  roleId: invite.roleId?._id ? String(invite.roleId._id) : String(invite.roleId || ''),
  roleKey: invite.roleId?.key || invite.roleKey || invite.role,
  roleName: invite.roleId?.name || invite.roleKey || invite.role,
  companyName: invite.companyName || '',
  status: invite.status,
  emailStatus: invite.emailStatus,
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt,
});

async function actorContext(req) {
  return req.authContext || resolveAccessContext({
    userId: req.user.userId,
    companyId: req.user.companyId,
  });
}

async function resolveAssignableRole(req, reference) {
  const role = await findCompanyRole(req.user.companyId, reference);
  if (!role) return { error: 'Selected role does not exist or is archived.' };
  const actor = await actorContext(req);
  if (!canManageRole(actor, role)) {
    return { error: 'You cannot assign a role with equal or greater authority than your own.' };
  }
  return { role };
}

async function sendInviteEmail({ invite, token }) {
  const link = `${process.env.CLIENT_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  const companyName = escapeHtml(invite.companyName || 'JNR ERP');
  const inviteeName = escapeHtml(invite.inviteeName || '');
  const roleName = escapeHtml(invite.roleId?.name || invite.roleKey);

  await sendMail({
    to: invite.email,
    subject: `You're invited to ${invite.companyName || 'JNR ERP'}`,
    html: `
      <div style="background:#f4f4f5;padding:28px;font-family:Arial,sans-serif">
        <div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:28px">
          <h2 style="margin-top:0">${companyName}</h2>
          <p>Hello${inviteeName ? ` ${inviteeName}` : ''},</p>
          <p>You have been invited to join as <strong>${roleName}</strong>.</p>
          <p>This secure invitation expires in 7 days.</p>
          <p style="margin:28px 0">
            <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">
              Review invitation
            </a>
          </p>
          <p style="color:#71717a;font-size:12px">If you did not expect this invitation, you can ignore this email.</p>
        </div>
      </div>`,
  });
}

export async function createInvite(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const inviteeName = String(req.body?.name || req.body?.inviteeName || '').trim();
    const roleReference = req.body?.roleId || req.body?.role;
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ status: false, message: 'A valid email is required.' });
    }

    const { role, error } = await resolveAssignableRole(req, roleReference);
    if (error) return res.status(403).json({ status: false, message: error });

    const existingUser = await User.findOne({ email }).select('_id');
    if (existingUser) {
      const membership = await Membership.findOne({
        userId: existingUser._id,
        companyId: req.user.companyId,
      });
      if (membership?.status === 'active') {
        return res.status(409).json({ status: false, message: 'This person is already a member.' });
      }
    }

    await Invite.updateMany(
      { companyId: req.user.companyId, email, status: 'pending' },
      { $set: { status: 'revoked', revokedAt: new Date() } },
    );

    const company = await Company.findById(req.user.companyId).select('companyName').lean();
    const token = genToken();
    const invite = await Invite.create({
      companyId: req.user.companyId,
      email,
      inviteeName,
      roleId: role._id,
      roleKey: role.key,
      role: role.key,
      inviterId: req.user.userId,
      tokenHash: hash(token),
      companyName: company?.companyName || '',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    invite.roleId = role;

    try {
      await sendInviteEmail({ invite, token });
    } catch (mailError) {
      await Invite.updateOne(
        { _id: invite._id },
        {
          $set: {
            status: 'revoked',
            revokedAt: new Date(),
            emailStatus: 'undeliverable',
            emailStatusCode: mailError?.code || 'SEND_FAILED',
          },
        },
      );
      return res.status(502).json({
        status: false,
        message: 'The invitation email could not be delivered. No active invitation was left behind.',
      });
    }

    await recordUserAudit(req, 'invite.created', {
      metadata: { inviteId: invite._id, email, roleId: role._id },
    });
    return res.status(201).json({
      status: true,
      message: 'Invitation sent.',
      data: safeInvite(invite),
    });
  } catch (error) {
    console.error('createInvite error:', error);
    return res.status(500).json({ status: false, message: 'Failed to send invitation.' });
  }
}

export async function resendInvite(req, res) {
  try {
    const invite = await Invite.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
      status: 'pending',
    }).populate('roleId');
    if (!invite) return res.status(404).json({ status: false, message: 'Pending invitation not found.' });

    const { role, error } = await resolveAssignableRole(req, invite.roleId?._id);
    if (error) return res.status(403).json({ status: false, message: error });

    const token = genToken();
    invite.tokenHash = hash(token);
    invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    invite.emailStatus = 'active';
    invite.roleId = role;
    await invite.save();
    await sendInviteEmail({ invite, token });
    await recordUserAudit(req, 'invite.resent', { metadata: { inviteId: invite._id } });
    return res.json({ status: true, message: 'Invitation resent.', data: safeInvite(invite) });
  } catch (error) {
    console.error('resendInvite error:', error);
    return res.status(500).json({ status: false, message: 'Failed to resend invitation.' });
  }
}

export async function revokeInvite(req, res) {
  const invite = await Invite.findOneAndUpdate(
    { _id: req.params.id, companyId: req.user.companyId, status: 'pending' },
    { $set: { status: 'revoked', revokedAt: new Date(), tokenHash: hash(genToken()) } },
    { new: true },
  ).populate('roleId');
  if (!invite) return res.status(404).json({ status: false, message: 'Pending invitation not found.' });
  await recordUserAudit(req, 'invite.revoked', { metadata: { inviteId: invite._id } });
  return res.json({ status: true, message: 'Invitation revoked.' });
}

export async function validateInvite(req, res) {
  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ status: false, message: 'Invitation token is required.' });
  const invite = await Invite.findOne({ tokenHash: hash(token), status: 'pending' }).populate('roleId');
  if (!invite || invite.expiresAt <= new Date()) {
    return res.status(410).json({ status: false, message: 'This invitation is invalid or expired.' });
  }
  const existingAccount = Boolean(await User.exists({ email: invite.email }));
  return res.json({
    status: true,
    email: invite.email,
    companyName: invite.companyName,
    role: invite.roleId?.name || invite.roleKey,
    roleKey: invite.roleId?.key || invite.roleKey,
    name: invite.inviteeName || '',
    existingAccount,
    expiresAt: invite.expiresAt,
  });
}

export async function acceptInvite(req, res) {
  try {
    const token = String(req.body?.token || '');
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!token || !password) {
      return res.status(400).json({ status: false, message: 'Token and password are required.' });
    }

    const invite = await Invite.findOne({ tokenHash: hash(token), status: 'pending' })
      .select('+tokenHash')
      .populate('roleId');
    if (!invite || invite.expiresAt <= new Date() || !invite.roleId || invite.roleId.status !== 'active') {
      return res.status(410).json({ status: false, message: 'This invitation is invalid or expired.' });
    }

    let user = await User.findOne({ email: invite.email }).select('+password');
    if (user) {
      if (!(await user.comparePassword(password))) {
        return res.status(401).json({ status: false, message: 'Password is incorrect for the existing account.' });
      }
      if (user.status !== 'active') {
        return res.status(403).json({ status: false, message: 'This account is not active.' });
      }
    } else {
      if (name.length < 2) {
        return res.status(400).json({ status: false, message: 'Your name is required.' });
      }
      user = await User.create({
        email: invite.email,
        fullName: name,
        password,
        companyId: invite.companyId,
        role: invite.roleId.key,
        status: 'active',
        isVerified: true,
        isSetupCompleted: true,
        createdBy: invite.inviterId,
      });
    }

    const membership = await Membership.findOneAndUpdate(
      { userId: user._id, companyId: invite.companyId },
      {
        $set: {
          roleId: invite.roleId._id,
          status: 'active',
          restoredAt: new Date(),
        },
        $setOnInsert: {
          userId: user._id,
          companyId: invite.companyId,
          joinedAt: new Date(),
          invitedBy: invite.inviterId,
        },
      },
      { upsert: true, new: true },
    );

    if (!user.companyId) {
      user.companyId = invite.companyId;
      user.role = invite.roleId.key;
      await user.save({ validateBeforeSave: false });
    }

    invite.status = 'accepted';
    invite.acceptedAt = new Date();
    invite.tokenHash = hash(genToken());
    await invite.save();
    await recordUserAudit(
      { ...req, user: { userId: invite.inviterId, companyId: invite.companyId } },
      'invite.accepted',
      { targetUserId: user._id, metadata: { membershipId: membership._id, inviteId: invite._id } },
    );
    return res.json({
      status: true,
      message: 'Invitation accepted. You can now log in.',
      data: { email: user.email },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ status: false, message: 'This membership already exists.' });
    }
    console.error('acceptInvite error:', error);
    return res.status(500).json({ status: false, message: 'Failed to accept invitation.' });
  }
}

export async function declineInviteByToken(req, res) {
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ status: false, message: 'Invitation token is required.' });
  const invite = await Invite.findOneAndUpdate(
    { tokenHash: hash(token), status: 'pending' },
    {
      $set: {
        status: 'declined',
        declinedAt: new Date(),
        tokenHash: hash(genToken()),
      },
    },
    { new: true },
  );
  if (!invite) return res.status(410).json({ status: false, message: 'This invitation is invalid or expired.' });
  return res.json({ status: true, message: 'Invitation declined.' });
}

export async function listInvites(req, res) {
  try {
    const allowedStatuses = ['pending', 'accepted', 'revoked', 'expired', 'declined'];
    const requested = String(req.query?.status || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedStatuses.includes(value));
    const filter = { companyId: req.user.companyId };
    if (requested.length) filter.status = { $in: requested };
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const [invites, total] = await Promise.all([
      Invite.find(filter)
        .populate('roleId', 'key name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invite.countDocuments(filter),
    ]);
    return res.json({
      status: true,
      data: invites.map(safeInvite),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to list invitations.' });
  }
}

export async function listUsers(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const q = String(req.query.q || '').trim();
    const sortMap = {
      name: 'user.fullName',
      email: 'user.email',
      role: 'role.name',
      status: 'status',
      lastSeenAt: 'user.lastSeenAt',
      createdAt: 'createdAt',
    };
    const sortField = sortMap[req.query.sortBy] || 'user.fullName';
    const direction = req.query.sortDir === 'desc' ? -1 : 1;
    const match = {
      companyId: new mongoose.Types.ObjectId(req.user.companyId),
    };
    if (['active', 'suspended', 'disabled'].includes(req.query.status)) match.status = req.query.status;

    const pipeline = [
      { $match: match },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $lookup: { from: 'roles', localField: 'roleId', foreignField: '_id', as: 'role' } },
      { $unwind: '$role' },
    ];
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'user.fullName': regex },
            { 'user.email': regex },
            { 'role.name': regex },
            { 'role.key': regex },
          ],
        },
      });
    }
    pipeline.push(
      {
        $facet: {
          data: [
            { $sort: { [sortField]: direction, _id: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: '$user._id',
                membershipId: '$_id',
                fullName: '$user.fullName',
                email: '$user.email',
                status: 1,
                accountStatus: '$user.status',
                lastSeenAt: '$user.lastSeenAt',
                joinedAt: 1,
                role: '$role.key',
                roleId: '$role._id',
                roleName: '$role.name',
                roleRank: '$role.rank',
                isOwner: '$role.isOwner',
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    );
    const [result] = await Membership.aggregate(pipeline);
    const total = result?.total?.[0]?.count || 0;
    return res.json({
      status: true,
      data: result?.data || [],
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('listUsers error:', error);
    return res.status(500).json({ status: false, message: 'Failed to list members.' });
  }
}

export async function updateUserRole(req, res) {
  try {
    const targetUserId = req.params.id;
    if (!mongoose.isValidObjectId(targetUserId)) {
      return res.status(400).json({ status: false, message: 'Invalid member id.' });
    }
    if (String(req.user.userId) === String(targetUserId)) {
      return res.status(400).json({ status: false, message: 'You cannot change your own role.' });
    }
    const membership = await Membership.findOne({
      userId: targetUserId,
      companyId: req.user.companyId,
    }).populate('roleId');
    if (!membership) return res.status(404).json({ status: false, message: 'Member not found.' });
    const nextRole = await findCompanyRole(req.user.companyId, req.body?.roleId || req.body?.role);
    if (!nextRole) return res.status(400).json({ status: false, message: 'Selected role is invalid.' });
    const actor = await actorContext(req);
    if (!canManageRole(actor, membership.roleId, { allowEqual: true }) || !canManageRole(actor, nextRole)) {
      return res.status(403).json({ status: false, message: 'You cannot make this role change.' });
    }
    if (membership.roleId.isOwner && !nextRole.isOwner) {
      const remainingOwners = await countActiveOwners(req.user.companyId, targetUserId);
      if (remainingOwners === 0) {
        return res.status(409).json({ status: false, message: 'The company must always have an active owner.' });
      }
    }
    const previousRoleId = membership.roleId._id;
    membership.roleId = nextRole._id;
    membership.accessVersion = (membership.accessVersion || 0) + 1;
    await membership.save();
    await User.updateOne(
      { _id: targetUserId, companyId: req.user.companyId },
      { $set: { role: nextRole.key } },
    );
    await RefreshToken.deleteMany({ userId: targetUserId, companyId: req.user.companyId });
    await recordUserAudit(req, 'membership.role_changed', {
      targetUserId,
      metadata: { fromRoleId: previousRoleId, toRoleId: nextRole._id },
    });
    return res.json({
      status: true,
      message: 'Member role updated. Company sessions were revoked.',
      data: { id: targetUserId, roleId: nextRole._id, role: nextRole.key, roleName: nextRole.name },
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update member role.' });
  }
}

export async function removeUser(req, res) {
  try {
    const targetUserId = req.params.id;
    if (String(req.user.userId) === String(targetUserId)) {
      return res.status(400).json({ status: false, message: 'You cannot suspend yourself.' });
    }
    const membership = await Membership.findOne({
      userId: targetUserId,
      companyId: req.user.companyId,
    }).populate('roleId');
    if (!membership) return res.status(404).json({ status: false, message: 'Member not found.' });
    const actor = await actorContext(req);
    if (!canManageRole(actor, membership.roleId, { allowEqual: true })) {
      return res.status(403).json({ status: false, message: 'You cannot suspend this member.' });
    }
    if (membership.roleId.isOwner && await countActiveOwners(req.user.companyId, targetUserId) === 0) {
      return res.status(409).json({ status: false, message: 'The last owner cannot be suspended.' });
    }
    membership.status = 'suspended';
    membership.accessVersion = (membership.accessVersion || 0) + 1;
    membership.suspendedAt = new Date();
    membership.suspendedBy = req.user.userId;
    await membership.save();
    await RefreshToken.deleteMany({ userId: targetUserId, companyId: req.user.companyId });
    await recordUserAudit(req, 'membership.suspended', { targetUserId });
    return res.json({ status: true, message: 'Member suspended.', data: { id: targetUserId } });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to suspend member.' });
  }
}

export async function restoreUser(req, res) {
  const membership = await Membership.findOneAndUpdate(
    { userId: req.params.id, companyId: req.user.companyId, status: { $ne: 'active' } },
    {
      $set: {
        status: 'active',
        restoredAt: new Date(),
        restoredBy: req.user.userId,
      },
      $inc: { accessVersion: 1 },
      $unset: { suspendedAt: 1, suspendedBy: 1 },
    },
    { new: true },
  );
  if (!membership) return res.status(404).json({ status: false, message: 'Suspended member not found.' });
  await User.updateOne(
    { _id: req.params.id, status: 'disabled' },
    { $set: { status: 'active' }, $unset: { disabledAt: 1, disabledBy: 1 } },
  );
  await recordUserAudit(req, 'membership.restored', { targetUserId: req.params.id });
  return res.json({ status: true, message: 'Member restored.' });
}

export async function meUser(req, res) {
  const user = await User.findById(req.user.userId)
    .select('fullName email preferences lastSeenAt status createdAt updatedAt')
    .lean();
  if (!user) return res.status(404).json({ status: false, message: 'User not found.' });
  return res.json({
    status: true,
    user: {
      ...user,
      role: req.user.role,
      roleName: req.user.roleName,
      companyId: req.user.companyId,
      membershipId: req.user.membershipId,
    },
  });
}

export async function updateMyProfile(req, res) {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    if (fullName.length < 2 || fullName.length > 120) {
      return res.status(400).json({ status: false, message: 'Name must be between 2 and 120 characters.' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: { fullName } },
      { new: true, runValidators: true },
    ).select('fullName email preferences');
    await recordUserAudit(req, 'profile.updated', { targetUserId: req.user.userId });
    return res.json({ status: true, message: 'Profile updated.', user });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update profile.' });
  }
}

export async function updateMyPreferences(req, res) {
  try {
    const allowedThemes = ['light', 'dark', 'system'];
    const allowedLanguages = ['en', 'hi', 'fr'];
    const update = {};
    if (req.body?.theme !== undefined) {
      if (!allowedThemes.includes(req.body.theme)) {
        return res.status(400).json({ status: false, message: 'Invalid theme.' });
      }
      update['preferences.theme'] = req.body.theme;
    }
    if (req.body?.language !== undefined) {
      if (!allowedLanguages.includes(req.body.language)) {
        return res.status(400).json({ status: false, message: 'Invalid language.' });
      }
      update['preferences.language'] = req.body.language;
    }
    for (const key of ['emailUpdates', 'inAppAlerts']) {
      if (typeof req.body?.notifications?.[key] === 'boolean') {
        update[`preferences.notifications.${key}`] = req.body.notifications[key];
      }
    }
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: update },
      { new: true, runValidators: true },
    ).select('preferences');
    return res.json({ status: true, message: 'Preferences updated.', preferences: user.preferences });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update preferences.' });
  }
}

export async function listUserAudit(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const rows = await UserAuditLog.find({ companyId: req.user.companyId })
    .populate('actorId', 'fullName email')
    .populate('targetUserId', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return res.json({ status: true, data: rows });
}
