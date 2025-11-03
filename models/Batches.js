import mongoose from 'mongoose';
const batchesSchema = new mongoose.Schema(
  {
    // Keep existing field name to avoid breaking existing data
    batche_id: { type: String, required: true, trim: true, unique: true },

    // Use a consistent lowercase field name for dates
    date: { type: Date, required: true },

    // From your payload: numbersBatches: 20
    numbersBatches: { type: Number, required: true, min: 1 },

    // From your payload: rawMaterials: [{ name: ObjectId, weight: Number }]
    // Map `name` (ObjectId string) to `rawMaterial` ref, and store weight
    rawMaterials: [
      {
        // store only the ObjectId reference for the raw material
        rawMaterial_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RawMaterial', required: true },
        // line-item quantity and unit
        // rawMaterialName: { type: String, required: true, trim: true },
        weight: { type: Number, required: true, min: 1 },
        unit: { type: String, default: 'kg' },
      }
    ],
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// Useful indices
batchesSchema.index({ batche_id: 1 }, { unique: true });
batchesSchema.index({ createdBy: 1, date: -1 });

export default mongoose.model('Batch', batchesSchema);