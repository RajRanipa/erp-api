import 'dotenv/config';
import mongoose from 'mongoose';
import Company from '../models/Company.js';
import Invite from '../models/Invite.js';
import Membership from '../models/Membership.js';
import Permission from '../models/Permission.js';
import RefreshToken from '../models/RefreshToken.js';
import Role from '../models/Role.js';
import SignupOtp from '../models/SignupOtp.js';
import User from '../models/User.js';
import {
  ensureCompanyRoles,
  findCompanyRole,
  syncPermissionCatalog,
} from '../services/accessControlService.js';
import { normalizeRoleKey } from '../config/permissionCatalog.js';
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_TEMPLATES } from '../config/permissionCatalog.js';

const APPLY = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || 'mongodb://127.0.0.1:27017/orient-erp';

const report = {
  mode: APPLY ? 'APPLY' : 'AUDIT',
  companies: 0,
  usersWithCompany: 0,
  rolesToCreate: 0,
  rolesNeedingRepair: 0,
  membershipsToCreate: 0,
  invitesToMigrate: 0,
  sessionsToRevoke: 0,
  staleOtpsToRemove: 0,
  permissionDefinitions: 0,
  updated: {
    companies: 0,
    memberships: 0,
    invites: 0,
    sessionsRevoked: 0,
    staleOtps: 0,
  },
  blockers: [],
};

async function reconcileTtlIndex(Model) {
  const indexes = await Model.collection.indexes();
  const expiresIndex = indexes.find((index) => (
    index.key?.expiresAt === 1 && Object.keys(index.key).length === 1
  ));
  if (expiresIndex && expiresIndex.expireAfterSeconds !== 0) {
    try {
      await mongoose.connection.db.command({
        collMod: Model.collection.collectionName,
        index: { name: expiresIndex.name, expireAfterSeconds: 0 },
      });
    } catch {
      await Model.collection.dropIndex(expiresIndex.name);
      await Model.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: expiresIndex.name },
      );
    }
  }
}

try {
  await mongoose.connect(mongoUri, { autoIndex: false });
  const migrationState = mongoose.connection.db.collection('systemmigrations');
  const sessionResetMarker = await migrationState.findOne({
    _id: 'user-module-v2-session-reset',
  });

  const companies = await Company.find({}).select('_id').lean();
  report.companies = companies.length;
  const users = await User.find({ companyId: { $ne: null } })
    .select('_id companyId role status createdAt')
    .lean();
  report.usersWithCompany = users.length;

  for (const company of companies) {
    const existingRoles = await Role.find({ companyId: company._id }).select('key permissions rank').lean();
    const byKey = new Map(existingRoles.map((role) => [role.key, role]));
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const role = byKey.get(template.key);
      if (!role) report.rolesToCreate += 1;
      else if (!Array.isArray(role.permissions) || !Number.isFinite(role.rank)) {
        report.rolesNeedingRepair += 1;
      }
    }
    const activeOwnerRoles = await Role.countDocuments({
      companyId: company._id,
      isOwner: true,
      status: 'active',
    });
    if (activeOwnerRoles > 1) {
      report.blockers.push({
        companyId: String(company._id),
        message: 'More than one active role is marked as the protected owner role.',
      });
    }
  }

  for (const user of users) {
    const exists = await Membership.exists({ userId: user._id, companyId: user.companyId });
    if (!exists) report.membershipsToCreate += 1;
  }

  report.invitesToMigrate = await Invite.countDocuments({
    $or: [{ roleId: { $exists: false } }, { roleKey: { $exists: false } }],
  });
  report.sessionsToRevoke = sessionResetMarker ? 0 : await RefreshToken.countDocuments({});
  report.staleOtpsToRemove = await SignupOtp.countDocuments({
    $or: [{ purpose: { $exists: false } }, { otpHash: { $exists: false } }],
  });

  if (APPLY) {
    report.permissionDefinitions = await syncPermissionCatalog();
    await Permission.collection.updateMany({}, { $unset: { roles: '' } });
    await Permission.updateMany(
      { key: { $nin: ALL_PERMISSION_KEYS } },
      { $set: { status: 'deprecated' } },
    );
    const permissionIndexes = await Permission.collection.indexes();
    if (permissionIndexes.some((index) => index.name === 'roles_1')) {
      await Permission.collection.dropIndex('roles_1');
    }

    for (const company of companies) {
      await ensureCompanyRoles(company._id);
      report.updated.companies += 1;
    }

    for (const user of users) {
      try {
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
        await Membership.findOneAndUpdate(
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
          { upsert: true },
        );
        report.updated.memberships += 1;
      } catch (error) {
        report.blockers.push({ userId: String(user._id), message: error.message });
      }
    }

    const legacyInvites = await Invite.collection.find({
      $or: [{ roleId: { $exists: false } }, { roleKey: { $exists: false } }],
    }).toArray();
    for (const invite of legacyInvites) {
      const key = normalizeRoleKey(invite.role || 'viewer') || 'viewer';
      const role = await findCompanyRole(invite.companyId, key)
        || await findCompanyRole(invite.companyId, 'viewer');
      if (!role) {
        report.blockers.push({ inviteId: String(invite._id), message: 'No compatible role found' });
        continue;
      }
      await Invite.collection.updateOne(
        { _id: invite._id },
        {
          $set: {
            roleId: role._id,
            roleKey: role.key,
            role: role.key,
            inviteeName: invite.inviteeName || '',
          },
        },
      );
      report.updated.invites += 1;
    }

    if (!sessionResetMarker) {
      const sessionResult = await RefreshToken.deleteMany({});
      report.updated.sessionsRevoked = sessionResult.deletedCount;
      await migrationState.updateOne(
        { _id: 'user-module-v2-session-reset' },
        {
          $set: {
            completedAt: new Date(),
            reason: 'Refresh-token claims changed for company-scoped memberships.',
          },
        },
        { upsert: true },
      );
    }

    const otpResult = await SignupOtp.collection.deleteMany({
      $or: [{ purpose: { $exists: false } }, { otpHash: { $exists: false } }],
    });
    report.updated.staleOtps = otpResult.deletedCount;

    await reconcileTtlIndex(Invite);
    await reconcileTtlIndex(RefreshToken);
    await reconcileTtlIndex(SignupOtp);
    for (const Model of [Permission, Role, Membership, Invite, RefreshToken, SignupOtp]) {
      await Model.createIndexes();
    }
  } else {
    report.permissionDefinitions = await Permission.countDocuments({ status: 'active' });
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length) process.exitCode = 2;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
