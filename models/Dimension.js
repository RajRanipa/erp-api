import mongoose from 'mongoose';

const DimensionSchema = new mongoose.Schema(
  {
    length: Number,
    width: Number,
    thickness: Number,
    unit: {
      type: String,
      required: true,
      default: 'mm',
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    productType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
    },
  },
  { timestamps: true }
);

DimensionSchema.index({
  productType: 1,
  'length': 1,
  'width': 1,
  'thickness': 1,
}, { unique: true });

export default mongoose.model('Dimension', DimensionSchema);