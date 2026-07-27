import mongoose from 'mongoose';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import Membership from '../models/Membership.js';
import { ALL_PERMISSION_KEYS, normalizeRoleKey } from '../config/permissionCatalog.js';
import {
  canManageRole,
  findCompanyRole,
  resolveAccessContext,
  syncPermissionCatalog,
} from '../services/accessControlService.js';
import { permissionImplies } from '../services/accessControlService.js';
import { recordUserAudit } from '../utils/userAudit.js';

const roleDto = (role, memberCount = 0) => ({
  id: String(role._id),
  _id: String(role._id),
  key: role.key,
  name: role.name,
  description: role.description || '',
  rank: role.rank,
  isSystem: Boolean(role.isSystem),
  isOwner: Boolean(role.isOwner),
  status: role.status,
  permissions: role.permissions || [],
  memberCount,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

async function getActorContext(req) {
  return req.authContext || resolveAccessContext({
    userId: req.user.userId,
    companyId: req.user.companyId,
  });
}

async function resolveRole(req, reference) {
  return findCompanyRole(req.user.companyId, reference);
}

export const listPermissions = async (req, res) => {
  try {
    await syncPermissionCatalog();
    const { q = '', module = '' } = req.query;
    const filter = { status: 'active' };
    if (module) filter.module = String(module).trim().toLowerCase();
    if (q) {
      const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { key: new RegExp(escaped, 'i') },
        { label: new RegExp(escaped, 'i') },
      ];
    }
    const permissions = await Permission.find(filter)
      .select('key label description module')
      .sort({ module: 1, key: 1 })
      .lean();
    return res.json({ status: true, permissions });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to list permissions.' });
  }
};

export const listRoles = async (req, res) => {
  try {
    const roles = await Role.find({ companyId: req.user.companyId, status: 'active' })
      .sort({ rank: -1, name: 1 })
      .lean();
    const counts = await Membership.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(req.user.companyId),
          status: 'active',
        },
      },
      { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    const countByRole = new Map(counts.map((row) => [String(row._id), row.count]));
    return res.json({
      status: true,
      roles: roles.map((role) => roleDto(role, countByRole.get(String(role._id)) || 0)),
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to list roles.' });
  }
};

export const listAssignableRoles = async (req, res) => {
  const canAssign = req.user.isOwner
    || permissionImplies(req.user.permissions, 'users:invite:create')
    || permissionImplies(req.user.permissions, 'users:update:role');
  if (!canAssign) {
    return res.status(403).json({ status: false, message: 'You cannot assign company roles.' });
  }
  const actor = await getActorContext(req);
  const roles = await Role.find({ companyId: req.user.companyId, status: 'active' })
    .sort({ rank: -1, name: 1 })
    .lean();
  return res.json({
    status: true,
    roles: roles
      .filter((role) => canManageRole(actor, role))
      .map((role) => roleDto(role)),
  });
};

export const createRole = async (req, res) => {
  try {
    const actor = await getActorContext(req);
    const key = normalizeRoleKey(req.body?.key || req.body?.name);
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const rank = Math.max(1, Math.min(Number(req.body?.rank) || 20, 99));
    const requestedPermissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const permissions = [...new Set(requestedPermissions)];

    if (!key || name.length < 2 || name.length > 80) {
      return res.status(400).json({ status: false, message: 'A valid role name is required.' });
    }
    if (!actor.isOwner && rank >= Number(actor.role?.rank || 0)) {
      return res.status(403).json({ status: false, message: 'A role cannot have equal or greater authority than your role.' });
    }
    if (permissions.some((permission) => !ALL_PERMISSION_KEYS.includes(permission))) {
      return res.status(400).json({ status: false, message: 'One or more permissions are invalid.' });
    }

    const role = await Role.create({
      companyId: req.user.companyId,
      key,
      name,
      description,
      rank,
      permissions,
      createdBy: req.user.userId,
      updatedBy: req.user.userId,
    });
    await recordUserAudit(req, 'role.created', { metadata: { roleId: role._id, key } });
    return res.status(201).json({ status: true, data: roleDto(role) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ status: false, message: 'A role with this key already exists.' });
    }
    return res.status(500).json({ status: false, message: 'Failed to create role.' });
  }
};

export const updateRole = async (req, res) => {
  try {
    const role = await resolveRole(req, req.params.id);
    if (!role) return res.status(404).json({ status: false, message: 'Role not found.' });
    if (role.isOwner) {
      return res.status(400).json({ status: false, message: 'The owner role is protected.' });
    }
    const actor = await getActorContext(req);
    if (!canManageRole(actor, role, { allowEqual: true })) {
      return res.status(403).json({ status: false, message: 'You cannot manage this role.' });
    }

    if (typeof req.body?.name === 'string') role.name = req.body.name.trim();
    if (typeof req.body?.description === 'string') role.description = req.body.description.trim();
    if (req.body?.rank !== undefined) {
      const nextRank = Math.max(1, Math.min(Number(req.body.rank) || role.rank, 99));
      if (!actor.isOwner && nextRank >= Number(actor.role?.rank || 0)) {
        return res.status(403).json({ status: false, message: 'Role rank exceeds your authority.' });
      }
      role.rank = nextRank;
    }
    role.updatedBy = req.user.userId;
    await role.save();
    await recordUserAudit(req, 'role.updated', { metadata: { roleId: role._id } });
    return res.json({ status: true, data: roleDto(role) });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update role.' });
  }
};

export const deleteRole = async (req, res) => {
  try {
    const role = await resolveRole(req, req.params.id);
    if (!role) return res.status(404).json({ status: false, message: 'Role not found.' });
    if (role.isSystem || role.isOwner) {
      return res.status(400).json({ status: false, message: 'System roles cannot be archived.' });
    }
    const memberCount = await Membership.countDocuments({ roleId: role._id, status: 'active' });
    if (memberCount) {
      return res.status(409).json({
        status: false,
        message: 'Move all active members to another role before archiving this role.',
      });
    }
    role.status = 'archived';
    role.updatedBy = req.user.userId;
    await role.save();
    await recordUserAudit(req, 'role.archived', { metadata: { roleId: role._id } });
    return res.json({ status: true, message: 'Role archived.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to archive role.' });
  }
};

export const getRolePermissions = async (req, res) => {
  const role = await resolveRole(req, req.params.role);
  if (!role) return res.status(404).json({ status: false, message: 'Role not found.' });
  return res.json({ status: true, role: roleDto(role), permissions: role.permissions || [] });
};

export const getRolePermissionsbyRole = async (req, res) => (
  res.json({
    status: true,
    role: req.user.role,
    roleId: req.user.roleId,
    permissions: req.user.permissions || [],
  })
);

export const setRolePermissions = async (req, res) => {
  try {
    const reference = req.params.id || req.body?.roleId || req.body?.role;
    const role = await resolveRole(req, reference);
    if (!role) return res.status(404).json({ status: false, message: 'Role not found.' });
    if (role.isOwner) {
      return res.status(400).json({ status: false, message: 'Owner permissions are always unrestricted.' });
    }
    const actor = await getActorContext(req);
    if (!canManageRole(actor, role, { allowEqual: true })) {
      return res.status(403).json({ status: false, message: 'You cannot manage this role.' });
    }
    const requestedKeys = req.body?.keys ?? req.body?.permissions;
    if (!Array.isArray(requestedKeys)) {
      return res.status(400).json({ status: false, message: 'permissions must be an array.' });
    }
    const keys = [...new Set(requestedKeys)];
    if (keys.some((permission) => !ALL_PERMISSION_KEYS.includes(permission))) {
      return res.status(400).json({ status: false, message: 'One or more permissions are invalid.' });
    }
    role.permissions = keys;
    role.updatedBy = req.user.userId;
    await role.save();
    await recordUserAudit(req, 'role.permissions_updated', {
      metadata: { roleId: role._id, permissionCount: keys.length },
    });
    return res.json({
      status: true,
      message: 'Role permissions updated.',
      role: roleDto(role),
      assigned: role.permissions,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: 'Failed to update role permissions.' });
  }
};
