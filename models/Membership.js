import mongoose from 'mongoose';

const { Schema } = mongoose;

const MembershipSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    roleId: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'disabled'],
      default: 'active',
      index: true,
    },
    isDefault: { type: Boolean, default: false },
    accessVersion: { type: Number, default: 0 },
    joinedAt: { type: Date, default: Date.now },
    suspendedAt: Date,
    suspendedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    restoredAt: Date,
    restoredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

MembershipSchema.index(
  { userId: 1, companyId: 1 },
  { unique: true, name: 'uniq_user_company_membership' },
);
MembershipSchema.index({ companyId: 1, status: 1, roleId: 1, createdAt: -1 });

export default mongoose.models.Membership
  || mongoose.model('Membership', MembershipSchema);
