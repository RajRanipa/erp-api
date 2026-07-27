import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [10, 'Password must be at least 10 characters'],
      select: false,
    },
    role: {
      type: String,
      trim: true,
      lowercase: true,
      required: [true, 'Role is required'],
      default: 'employee',
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company'
    },
    preferences: {
      theme: {
        type: String,
        enum: ['light', 'dark', 'system'],
        default: 'light',
      },
      language: {
        type: String,
        enum: ['en', 'hi', 'fr'],
        default: 'en',
      },
      notifications: {
        emailUpdates: {
          type: Boolean,
          default: true,
        },
        inAppAlerts: {
          type: Boolean,
          default: true,
        },
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isSetupCompleted: {
      type: Boolean,
      default: false,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'disabled'],
      default: 'pending',
    },
    lastSeenAt: { type: Date },
    disabledAt: { type: Date },
    disabledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // auth hygiene — bump to invalidate existing JWTs
    tokenVersion: { type: Number, default: 0 },
    pendingEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    passwordChangedAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const rounds = 12;
  const salt = await bcrypt.genSalt(rounds);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (inputPassword) {
  // console.log('🔐 Hashed password:', this.password);
  // console.log('🔑 Input password:', inputPassword);

  const isMatch = await bcrypt.compare(inputPassword, this.password);
  // console.log('✅ Password match:', isMatch);

  return isMatch;
};

userSchema.index({ companyId: 1, status: 1, fullName: 1 });

const User = mongoose.model('User', userSchema);

export default User;
