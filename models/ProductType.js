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
    },
    catagoryID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('ProductType', ProductType);