import mongoose from 'mongoose';

const DensitySchema = new mongoose.Schema(
  {
    value: {
      type: Number,
      required: true,
      unique: true
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

export default mongoose.model('Density', DensitySchema);
