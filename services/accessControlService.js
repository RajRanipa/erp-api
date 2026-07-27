import mongoose from 'mongoose';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_TEMPLATES,
  PERMISSION_CATALOG,
  normalizeRoleKey,
} from '../config/permissionCatalog.js';

const objectId = (value) => (
  mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null
);

export async function syncPermissionCatalog() {
  const operations = PERMISSION_CATALOG.map((permission) => ({
    updateOne: {
      filter: { key: permission.key },
      update: {
        $set: {
          label: permission.label,
          description: permission.description,
          module: permission.module,
          status: 'active',
          system: true,
        },
      },
      upsert: true,
    },
  }));

  if (operations.length) {
    await Permission.bulkWrite(operations, { ordered: false });
  }

  return Permission.countDocuments({ status: 'active' });
}

export async function ensureCompanyRoles(companyId, actorId = null) {
  const scopedCompanyId = objectId(companyId);
  if (!scopedCompanyId) throw new Error('A valid companyId is required');

  await syncPermissionCatalog();

  for (const template of DEFAULT_ROLE_TEMPLATES) {
    await Role.updateOne(
      { companyId: scopedCompanyId, key: template.key },
      {
        $setOnInsert: {
          companyId: scopedCompanyId,
          key: template.key,
          name: template.name,
          description: template.description,
          rank: template.rank,
          isSystem: template.isSystem,
          isOwner: Boolean(template.isOwner),
          permissions: template.permissions,
          status: 'active',
          createdBy: objectId(actorId),
        },
      },
      { upsert: true },
    );
  }

  return Role.find({ companyId: scopedCompanyId, status: 'active' })
    .sort({ rank: -1, name: 1 })
    .lean();
}

export async function findCompanyRole(companyId, roleReference) {
  const scopedCompanyId = objectId(companyId);
  if (!scopedCompanyId || !roleReference) return null;

  const filter = { companyId: scopedCompanyId, status: 'active' };
  if (mongoose.isValidObjectId(roleReference)) {
    filter._id = roleReference;
  } else {
    filter.key = normalizeRoleKey(roleReference);
  }
  return Role.findOne(filter);
}

export async function ensureLegacyMembership(user) {
  if (!user?.companyId || !user?._id) return null;

  await ensureCompanyRoles(user.companyId, user._id);
  let role = await findCompanyRole(user.companyId, user.role || 'employee');

  if (!role) {
    const key = normalizeRoleKey(user.role || 'employee') || 'employee';
    role = await Role.findOneAndUpdate(
      { companyId: user.companyId, key },
      {
        $setOnInsert: {
          companyId: user.companyId,
          key,
          name: key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
          description: 'Migrated legacy role',
          permissions: [],
          rank: 20,
          createdBy: user._id,
        },
      },
      { upsert: true, new: true },
    );
  }

  return Membership.findOneAndUpdate(
    { userId: user._id, companyId: user.companyId },
    {
      $setOnInsert: {
        userId: user._id,
        companyId: user.companyId,
        roleId: role._id,
        status: user.status === 'active' ? 'active' : 'disabled',
        isDefault: true,
        joinedAt: user.createdAt || new Date(),
      },
    },
    { upsert: true, new: true },
  ).populate('roleId');
}

export async function resolveAccessContext({ userId, companyId = null }) {
  if (!mongoose.isValidObjectId(userId)) return null;

  const user = await User.findById(userId)
    .select('_id email fullName status isVerified tokenVersion companyId role isSetupCompleted')
    .lean();

  if (!user) return null;

  const requestedCompanyId = objectId(companyId || user.companyId);
  let membership = null;

  if (requestedCompanyId) {
    membership = await Membership.findOne({
      userId: user._id,
      companyId: requestedCompanyId,
    }).populate('roleId');

    if (!membership && user.companyId && String(user.companyId) === String(requestedCompanyId)) {
      membership = await ensureLegacyMembership(user);
    }
  }

  const role = membership?.roleId || null;
  const roleKey = role?.key || user.role || 'employee';
  const isOwner = Boolean(role?.isOwner || (!requestedCompanyId && roleKey === 'owner'));
  const permissions = isOwner
    ? ALL_PERMISSION_KEYS
    : [...new Set(role?.permissions || [])];

  return {
    user,
    membership,
    role,
    companyId: requestedCompanyId,
    roleKey,
    isOwner,
    permissions,
  };
}

export function permissionImplies(allowedPermissions, requiredPermission) {
  const allowed = allowedPermissions instanceof Set
    ? allowedPermissions
    : new Set(allowedPermissions || []);
  if (allowed.has(requiredPermission)) return true;
  const resource = String(requiredPermission || '').split(':')[0];
  return Boolean(resource && allowed.has(`${resource}:full`));
}

export function canManageRole(actorContext, targetRole, { allowEqual = false } = {}) {
  if (!actorContext || !targetRole) return false;
  if (actorContext.isOwner) return true;
  if (targetRole.isOwner) return false;
  const actorRank = Number(actorContext.role?.rank || 0);
  const targetRank = Number(targetRole.rank || 0);
  return allowEqual ? actorRank >= targetRank : actorRank > targetRank;
}

export async function countActiveOwners(companyId, excludedUserId = null) {
  const ownerRole = await Role.findOne({ companyId, isOwner: true, status: 'active' }).select('_id');
  if (!ownerRole) return 0;
  const filter = { companyId, roleId: ownerRole._id, status: 'active' };
  if (excludedUserId) filter.userId = { $ne: excludedUserId };
  return Membership.countDocuments(filter);
}

