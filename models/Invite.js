// models/Invite.js
import mongoose, { Schema } from 'mongoose';

const InviteSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  role: { type: String, enum: ['owner', 'admin', 'manager', 'store_operator', 'production_manager', 'employee', 'accountant', 'viewer', 'staff'], default: 'staff' },
  inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // security
  tokenHash: { type: String, required: true, unique: true }, // sha256(token)
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL index auto-purges
  status: { type: String, enum: ['pending','accepted','revoked','expired','declined'], default: 'pending', index: true },

  // audit
  acceptedAt: Date,
  revokedAt: Date,
  // optional company display
  companyName: String,
}, { timestamps: true });

// Helpful uniqueness per company to avoid duplicate pending invites
InviteSchema.index({ companyId: 1, email: 1, status: 1 });

export default mongoose.models.Invite || mongoose.model('Invite', InviteSchema);