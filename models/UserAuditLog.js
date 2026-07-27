import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserAuditLogSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    action: { type: String, required: true, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);

UserAuditLogSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.UserAuditLog
  || mongoose.model('UserAuditLog', UserAuditLogSchema);

