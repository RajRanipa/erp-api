import mongoose from 'mongoose';

const ProductType = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true,
      enum: ['blanket', 'bulk', 'board', 'module'],
    }
  },
  { timestamps: true }
);

export default mongoose.model('ProductType', ProductType);