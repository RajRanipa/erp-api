import mongoose from 'mongoose';

const Category = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      lowercase: true
    }
  },
  { timestamps: true }
);

export default mongoose.model('Category', Category);