import mongoose from 'mongoose';

const TemperatureSchema = new mongoose.Schema(
  {
    value: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      required: true,
      default: '°C'
    },
     productType: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProductType",
          required: true,
        },
  },
  { timestamps: true }
);

TemperatureSchema.index(
  { productType: 1, value: 1},
  { unique: true, }
);
export default mongoose.model('Temperature', TemperatureSchema);