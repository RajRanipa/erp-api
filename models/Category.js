import mongoose from 'mongoose';

const Category = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
      enum: ['raw material', 'finished goods', 'packing material', 'non-conformance'],
      lowercase: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
{ timestamps: true }
);

export default mongoose.model('Category', Category);