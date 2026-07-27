import mongoose from 'mongoose';
import { normalizeRoleKey } from '../config/permissionCatalog.js';

const { Schema } = mongoose;

const RoleSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      set: normalizeRoleKey,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    permissions: { type: [String], default: [] },
    rank: { type: Number, min: 1, max: 100, default: 20 },
    isSystem: { type: Boolean, default: false },
    isOwner: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

RoleSchema.index({ companyId: 1, key: 1 }, { unique: true, name: 'uniq_company_role_key' });
RoleSchema.index({ companyId: 1, status: 1, rank: -1, name: 1 });
RoleSchema.index(
  { companyId: 1, isOwner: 1 },
  {
    unique: true,
    name: 'uniq_company_owner_role',
    partialFilterExpression: { isOwner: true, status: 'active' },
  },
);

export default mongoose.models.Role || mongoose.model('Role', RoleSchema);

