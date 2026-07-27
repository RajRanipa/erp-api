import mongoose from 'mongoose';
import crypto from 'crypto';

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  token: {
    type: String,
    required: true,
    unique: true,
    select: false,
  },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, default: null },
  membershipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Membership', index: true, default: null },
  tokenVersion: { type: Number, required: true, default: 0 },
  sessionId: { type: String, required: true, unique: true, index: true, default: () => crypto.randomUUID() },
  userAgent: String,
  ip: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  device:{
    type: String,
  }
}, { timestamps: true });

// 👇 TTL index correctly defined here
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// 🔐 Hash the token before saving
refreshTokenSchema.pre('save', function (next) {
  if (!this.isModified('token')) return next();
  this.token = crypto.createHash('sha256').update(this.token).digest('hex');
  next();
});

// 💡 You can even add a static method to compare later if needed
refreshTokenSchema.statics.hashToken = function (plainToken) {
  let hextoken = crypto.createHash('sha256').update(plainToken).digest('hex');
  return hextoken
};

refreshTokenSchema.statics.findMatchingToken = async function (plainToken, userId) {
  // console.log('plainToken', plainToken);
  // console.log('userId', userId);
  const hashed = this.hashToken(plainToken);
  return await this.findOne({ token: hashed, userId }).select('+token');
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
