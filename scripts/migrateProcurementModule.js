import 'dotenv/config';
import mongoose from 'mongoose';
import Company from '../models/Company.js';
import DocumentSequence from '../models/DocumentSequence.js';
import GoodsReceipt from '../models/GoodsReceipt.js';
import Membership from '../models/Membership.js';
import Permission from '../models/Permission.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Role from '../models/Role.js';
import {
  DEFAULT_ROLE_TEMPLATES,
  PERMISSION_CATALOG,
} from '../config/permissionCatalog.js';
import { syncPermissionCatalog } from '../services/accessControlService.js';

const APPLY = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || 'mongodb://127.0.0.1:27017/orient-erp';
const procurementDefinitions = PERMISSION_CATALOG.filter(
  permission => permission.module === 'procurement',
);
const procurementKeys = new Set(procurementDefinitions.map(permission => permission.key));
const templateByKey = new Map(DEFAULT_ROLE_TEMPLATES.map(template => [template.key, template]));

const report = {
  mode: APPLY ? 'APPLY' : 'AUDIT',
  companies: 0,
  permissionDefinitions: procurementDefinitions.length,
  missingPermissionDefinitions: 0,
  rolesScanned: 0,
  rolesNeedingGrants: 0,
  grantsPlanned: 0,
  rolesUpdated: 0,
  membershipSessionsToRefresh: 0,
  membershipSessionsRefreshed: 0,
  indexesEnsured: 0,
  blockers: [],
};

try {
  await mongoose.connect(mongoUri, { autoIndex: false });
  const migrationState = mongoose.connection.db.collection('systemmigrations');
  const marker = await migrationState.findOne({ _id: 'procurement-module-v1' });
  const [companies, existingPermissions, roles] = await Promise.all([
    Company.find({}).select('_id').lean(),
    Permission.find({ key: { $in: [...procurementKeys] }, status: 'active' })
      .select('key')
      .lean(),
    Role.find({ isSystem: true, key: { $in: [...templateByKey.keys()] } })
      .select('_id companyId key permissions')
      .lean(),
  ]);
  report.companies = companies.length;
  report.missingPermissionDefinitions = Math.max(
    0,
    procurementDefinitions.length - existingPermissions.length,
  );
  report.rolesScanned = roles.length;
  const procurementRoleIds = roles
    .filter(role => (
      templateByKey.get(role.key)?.permissions || []
    ).some(permission => procurementKeys.has(permission)))
    .map(role => role._id);
  if (!marker?.membershipAccessRefreshedAt && procurementRoleIds.length) {
    report.membershipSessionsToRefresh = await Membership.countDocuments({
      roleId: { $in: procurementRoleIds },
      status: 'active',
    });
  }

  const updates = [];
  for (const role of roles) {
    const template = templateByKey.get(role.key);
    const expected = (template?.permissions || []).filter(permission => procurementKeys.has(permission));
    const current = new Set(role.permissions || []);
    const missing = expected.filter(permission => !current.has(permission));
    if (missing.length) {
      report.rolesNeedingGrants += 1;
      report.grantsPlanned += missing.length;
      updates.push({ roleId: role._id, missing });
    }
  }

  if (APPLY) {
    await syncPermissionCatalog();
    for (const update of updates) {
      await Role.updateOne(
        { _id: update.roleId },
        { $addToSet: { permissions: { $each: update.missing } } },
      );
      report.rolesUpdated += 1;
    }
    if (!marker?.membershipAccessRefreshedAt && procurementRoleIds.length) {
      const refreshed = await Membership.updateMany(
        { roleId: { $in: procurementRoleIds }, status: 'active' },
        { $inc: { accessVersion: 1 } },
      );
      report.membershipSessionsRefreshed = refreshed.modifiedCount;
    }
    const models = [
      DocumentSequence,
      PurchaseOrder,
      GoodsReceipt,
      PurchaseReturn,
      PurchaseInvoice,
    ];
    for (const Model of models) {
      await Model.createIndexes();
      report.indexesEnsured += 1;
    }
    await migrationState.updateOne(
      { _id: 'procurement-module-v1' },
      {
        $set: {
          completedAt: new Date(),
          permissionDefinitions: procurementDefinitions.length,
          rolesUpdated: report.rolesUpdated,
          membershipAccessRefreshedAt: marker?.membershipAccessRefreshedAt || new Date(),
        },
      },
      { upsert: true },
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length) process.exitCode = 2;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
