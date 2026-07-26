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
  { productType: 1, value: 1, unit: 1 },
  { unique: true, name: 'uniq_temperature_spec' }
);
TemperatureSchema.index({ value: 1 });
export default mongoose.model('Temperature', TemperatureSchema);
