// models/Invite.js
import mongoose, { Schema } from 'mongoose';

const InviteSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  inviteeName: { type: String, trim: true, maxlength: 120, default: '' },
  roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
  roleKey: { type: String, required: true, trim: true },
  // Legacy snapshot retained while old exports and deployments are migrated.
  role: { type: String, trim: true },
  inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // security
  tokenHash: { type: String, required: true, unique: true, select: false }, // sha256(token)
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL index auto-purges
  status: { type: String, enum: ['pending', 'accepted', 'revoked', 'expired', 'declined'], default: 'pending', index: true },

  // audit
  acceptedAt: Date,
  revokedAt: Date,
  declinedAt: Date,
  // optional company display
  // bounce tracking
  emailStatus: { type: String, enum: ['active', 'bounced', 'undeliverable'], default: 'active', index: true },
  emailStatusCode: { type: String },
  bouncedAt: { type: Date },
  companyName: String,
}, { timestamps: true });

// Helpful uniqueness per company to avoid duplicate pending invites
InviteSchema.index({ companyId: 1, email: 1, status: 1 });
InviteSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.Invite || mongoose.model('Invite', InviteSchema);
