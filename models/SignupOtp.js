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
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Optional: TTL index to auto-delete after expiry
// This will remove docs some time after expiresAt
SignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SignupOtp = mongoose.model('SignupOtp', SignupOtpSchema);

export default SignupOtp;