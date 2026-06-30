import mongoose from 'mongoose';

const ProductTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      unique: true, // Keep this unique so you only ever have one "blanket" document
      lowercase: true,
      enum: ['blanket', 'bulk', 'board', 'module', 'et'],
    },
    // Pluralized to 'categories' to make it obvious to other devs that it's an array
    categories: [ 
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: true,
      }
    ],
  },
  { timestamps: true }
);

export default mongoose.model('ProductType', ProductTypeSchema);