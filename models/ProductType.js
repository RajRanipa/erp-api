import mongoose from 'mongoose';

const ProductType = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true,
      enum: ['blanket', 'bulk', 'board', 'module', 'et'],
    }
  },
  { timestamps: true }
);

export default mongoose.model('ProductType', ProductType);