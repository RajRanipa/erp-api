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
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: { 
      type: String, 
      enum: ['admin', 'manager', 'employee'], 
      default: 'employee' 
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
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const rounds = 10;
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

const User = mongoose.model('User', userSchema);

export default User;
