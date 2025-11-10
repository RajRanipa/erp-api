// controllers/inviteController.js
import crypto from 'crypto';
import Invite from '../models/Invite.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import sendMail from '../utils/sendMail.js'; // your nodemailer/helper
import {rolePermissions} from '../config/rolePermissions.js';
import mongoose from 'mongoose';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const genToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Force logout across all devices:
 * - Bumps tokenVersion so existing JWTs become invalid (server must check tokenVersion on each request).
 * - Deletes refresh tokens if a RefreshToken model exists.
 */
async function forceLogoutEverywhere(userId) {
  // Ensure any existing tokens become invalid
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });

  // If you keep refresh tokens, clear them (works only if model is registered)
  try {
    const RT = mongoose.models?.RefreshToken;
    if (RT) {
      await RT.deleteMany({ userId });
    }
  } catch (e) {
    // ignore if model isn't present
  }
}

export async function createInvite(req, res) {
  console.log('createInvite hit -> ', req.user);
  // requirePerm('users:invite')
  const { email, role = 'staff' } = req.body || {};
  const companyId = req.user.companyId;

  // 1) do not allow inviting an email that already exists as a User (global uniqueness)
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ status:false, message:'User with this email already exists' });

  // 2) close older pending invites for same pair (optional)
  await Invite.updateMany(
    { companyId, email, status: 'pending' },
    { $set: { status: 'revoked', revokedAt: new Date() } }
  );

  // ensure company info is available for new invite
  let company = null;
  try {
    company = await Company.findById(companyId).select('companyName').lean();
  } catch (err) {
    console.error('Failed to fetch company info for invite:', err);
  }

  const token = genToken();
  const tokenHash = hash(token);

  // return // console.log('company', company);
  const invite = await Invite.create({
    companyId,
    email,
    role,
    inviterId: req.user.id || req.user._id || null,
    tokenHash,
    companyName: company?.companyName || '',
    expiresAt: new Date(Date.now() + 7*24*60*60*1000) // 7 days
  });

  const link = `${process.env.CLIENT_URL}/accept-invite?token=${encodeURIComponent(token)}`;

  await sendMail({
    to: email,
    subject: `You're invited to ${company?.companyName || 'our JNR ERP'}`,
    html: `
      <p>Hello,</p>
      <p>You’ve been invited to join <b>${company?.companyName || 'our JNR ERP'}</b> as <b>${role}</b>.</p>
      <p><a href="${link}">Accept your invite</a> (valid for 7 days)</p>
    `
  });

  return res.json({ status:true, message:'Invite sent', data: { id: invite._id, email, role } });
}

export async function resendInvite(req, res) {
  // requirePerm('users:invite')
  const { id } = req.params;
  const invite = await Invite.findOne({ _id: id, companyId: req.user.companyId });
  // console.log('resendInvite hit', invite);
  if (!invite || invite.status !== 'pending') return res.status(404).json({ status:false, message:'Invite not found' });
  
  // rotate token
  const token = genToken();
  invite.tokenHash = hash(token);
  invite.expiresAt = new Date(Date.now() + 7*24*60*60*1000);
  await invite.save();

  const link = `${process.env.CLIENT_URL}/accept-invite?token=${encodeURIComponent(token)}`;
  await sendMail({ to: invite.email, subject: 'Your invite link', html: `<a href="${link}">Accept invite</a>` });

  res.json({ status:true, message:'Invite re-sent' });
}

export async function revokeInvite(req, res) {
  // requirePerm('users:invite')
  const { id } = req.params;
  const invite = await Invite.findOneAndUpdate(
    { _id: id, companyId: req.user.companyId, status: 'pending' },
    { $set: { status: 'revoked', revokedAt: new Date() } },
    { new: true }
  );
  if (!invite) return res.status(404).json({ status:false, message:'Invite not found' });
  res.json({ status:true, message:'Invite revoked' });
}

export async function validateInvite(req, res) {
  const { token } = req.query || {};
  if (!token) return res.status(400).json({ status:false, message:'Missing token' });

  const invite = await Invite.findOne({ tokenHash: hash(token), status: 'pending' });
  if (!invite) return res.status(410).json({ status:false, message:'Invalid or expired invite' });
  if (invite.expiresAt < new Date()) return res.status(410).json({ status:false, message:'Invite expired' });

  res.json({ status:true, data:{ email: invite.email, companyName: invite.companyName, role: invite.role } });
}

export async function acceptInvite(req, res) {
  const { token, name, password } = req.body || {};
  if (!token || !name || !password) return res.status(400).json({ status:false, message:'Missing fields' });

  const invite = await Invite.findOne({ tokenHash: hash(token), status: 'pending' });
  if (!invite) return res.status(410).json({ status:false, message:'Invalid or expired invite' });
  if (invite.expiresAt < new Date()) return res.status(410).json({ status:false, message:'Invite expired' });

  // email must still not exist
  const existing = await User.findOne({ email: invite.email });
  if (existing) return res.status(409).json({ status:false, message:'Email already registered' });

  // create user under company
  const user = await User.create({
    email: invite.email,
    fullName :name,
    password,
    companyId: invite.companyId,
    isSetupCompleted:  invite.companyId ? true : false,
    role: invite.role,
    permissions: rolePermissions[invite.role], // your helper
    status: 'active'
  });

  invite.status = 'accepted';
  invite.acceptedAt = new Date();
  await invite.save();

  // stick to your policy: DO NOT log in on accept → redirect to login
  res.json({ status:true, message:'Account created. Please log in.', data:{ email: user.email } });
}

export async function listInvites(req, res) {
  try {
    const { status } = req.query || {};
    const filter = { companyId: req.user?.companyId };
    if (status && typeof status === 'string') {
      // allow comma-separated: pending,accepted
      const statuses = status.split(',').map(s => s.trim().toLowerCase());
      filter.status = { $in: statuses };
    }

    // Optional pagination
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const invites = await Invite.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-token') // don't leak token in lists
      .lean();

    const total = await Invite.countDocuments(filter);

    res.json({ status: true, data: invites, meta: { total, page, limit } });
  } catch (err) {
    console.error('listInvites error:', err);
    res.status(500).json({ status: false, message: 'Failed to list invites' });
  }
}
// controllers/inviteController.js

export const declineInviteByToken = async (req, res) => {
  // console.log('declineInviteByToken hit');
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ status: false, message: 'Missing token' });
    // console.log('token', token);
    const invite = await Invite.findOne({ tokenHash: hash(token) });
    if (!invite) return res.status(404).json({ status: false, message: 'Invalid invite token' });
    
    if (invite.status !== 'pending')
      return res.status(400).json({ status: false, message: `Invite already ${invite.status}` });
    
    if (invite.expiresAt && invite.expiresAt < new Date())
      return res.status(400).json({ status: false, message: 'Invite expired' });
    
    invite.status = 'declined';
    invite.declinedAt = new Date();
    // Optional: rotate/clear token so it can’t be reused
    invite.tokenHash = undefined;
    await invite.save();
    // console.log('invite', invite);

    return res.json({ status: true, message: 'Invite declined' });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Failed to decline invite' });
  }
};

// controllers/userController.js
// Optional: only if you store refresh tokens
// import RefreshToken from '../models/RefreshToken.js';

export async function removeUser(req, res) {
  const actingUser = req.user; // populated by your auth middleware
  const { id } = req.params;

  try {
    // 1) You cannot remove yourself
    if (String(actingUser._id) === String(id)) {
      return res.status(400).json({ status: false, message: 'You cannot remove yourself.' });
    }

    // 2) Find the user in the same company
    const user = await User.findOne({ _id: id, companyId: actingUser.companyId });
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found in your company.' });
    }

    // 3) Prevent removing the last owner
    if (user.role === 'owner') {
      const ownerCount = await User.countDocuments({
        companyId: user.companyId,
        role: 'owner',
        status: 'active',
        _id: { $ne: user._id }
      });
      if (ownerCount === 0) {
        return res.status(400).json({
          status: false,
          message: 'Cannot remove the last owner. Promote another user to owner first.'
        });
      }
    }

    // 4) Soft delete (disable the account) + bump tokenVersion
    user.status = 'disabled';
    user.disabledAt = new Date();
    user.disabledBy = actingUser._id;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // 5) Optional: clear refresh tokens if you store them
    // await RefreshToken.deleteMany({ userId: user._id }).catch(() => {});

    return res.json({
      status: true,
      message: 'User removed (disabled) successfully.',
      data: { id: user._id }
    });
  } catch (err) {
    console.error('removeUser error:', err);
    return res.status(500).json({ status: false, message: 'Failed to remove user.' });
  }
}

export async function updateUserRole(req, res) {
  const actingUser = req.user; // set by auth middleware
  const { id } = req.params;
  const { role: nextRole } = req.body || {};

  try {
    // validate role
    const allowedRoles = Object.keys(rolePermissions);
    if (!nextRole || !allowedRoles.includes(nextRole)) {
      return res.status(400).json({ status: false, message: 'Invalid role' });
    }

    // You cannot change your own role here (optional safety)
    if (String(actingUser._id) === String(id)) {
      return res.status(400).json({ status: false, message: 'You cannot change your own role.' });
    }

    // find target user in same company
    const user = await User.findOne({ _id: id, companyId: actingUser.companyId });
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found in your company.' });
    }

    // prevent demoting the last owner
    if (user.role === 'owner' && nextRole !== 'owner') {
      const ownerCount = await User.countDocuments({ companyId: user.companyId, role: 'owner', status: 'active', _id: { $ne: user._id } });
      if (ownerCount === 0) {
        return res.status(400).json({ status: false, message: 'Cannot change role of the last owner.' });
      }
    }

    user.role = nextRole;
    // realign permissions with role map
    user.permissions = rolePermissions[nextRole] || [];
    await user.save();

    // Invalidate all existing sessions (JWTs + refresh tokens if any)
    await forceLogoutEverywhere(user._id);

    return res.json({ status: true, message: 'Role updated; user must log in again.', data: { id: user._id, role: user.role } });
  } catch (err) {
    console.error('updateUserRole error:', err);
    return res.status(500).json({ status: false, message: 'Failed to update role' });
  }
}

export async function listUsers(req, res) {
  try {
    const { status } = req.query || {};
    const filter = { companyId: req.user?.companyId };
    if (status && typeof status === 'string') {
      // allow comma-separated: pending,accepted
      const statuses = status.split(',').map(s => s.trim().toLowerCase());
      filter.status = { $in: statuses };
    }

    // Optional pagination
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-token') // don't leak token in lists
      .lean();

    const total = await User.countDocuments(filter);

    res.json({ status: true, data: users, meta: { total, page, limit } });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ status: false, message: 'Failed to list users' });
  }
}