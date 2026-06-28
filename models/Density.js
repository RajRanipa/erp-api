import mongoose from 'mongoose';

const DensitySchema = new mongoose.Schema(
  {
    value: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      required: true,
      default: 'kg/m³'
    },
    productType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
    },
  },
  { timestamps: true }
);

DensitySchema.index({ value: 1, unit: 1, productType: 1 }, { unique: true });
export default mongoose.model('Density', DensitySchema);
