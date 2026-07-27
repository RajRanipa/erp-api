// backend-api/models/SignupOtp.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const SignupOtpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    purpose: {
      type: String,
      enum: ['signup', 'login', 'password_reset', 'email_change'],
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
  }
);

// Optional: TTL index to auto-delete after expiry
// This will remove docs some time after expiresAt
SignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SignupOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

const SignupOtp = mongoose.model('SignupOtp', SignupOtpSchema);

export default SignupOtp;
