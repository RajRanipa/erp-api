

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * QCCheck — lightweight quality sampling tied to a Manufacturing Order.
 *
 * Fits Raj's process:
 *  - Density check before plastic packing (sampling, not every roll)
 *  - Length check after cutting (sampling)
 *  - Optionally link to campaign and product for easier reporting
 */

export const QC_TYPES = [
  'DENSITY',     // density verification (kg/m³)
  'DIM_LENGTH',  // length verification (mm or m)
];

export const QC_RESULTS = [
  'PASS',
  'FAIL',
];

const QCCheckSchema = new Schema({
  // Context
  mo: { type: Schema.Types.ObjectId, ref: 'ManufacturingOrder', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product' },
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },

  // What was checked
  type: { type: String, enum: QC_TYPES, required: true },
  result: { type: String, enum: QC_RESULTS, required: true },

  // Measurement payload (optional)
  measuredValue: { type: Number },          // e.g., density value or measured length
  measuredUom: { type: String },             // 'kg/m³', 'mm', 'm'
  sampleCount: { type: Number, default: 1, min: 1 },

  // Optional attribute snapshots for blankets
  dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
  densityRef: { type: Schema.Types.ObjectId, ref: 'Density' },
  temperature: { type: Schema.Types.ObjectId, ref: 'Temperature' },

  // Who/when/notes
  inspector: { type: String, trim: true },   // operator name or id string (simple for now)
  notes: { type: String, trim: true },

  // When the check actually happened (defaults to createdAt if not provided)
  checkAt: { type: Date },
}, { timestamps: true });

// Auto-snapshot attributes from MO -> Product if not provided
QCCheckSchema.pre('save', async function(next) {
  try {
    if (this.product && (!this.dimension || !this.densityRef || !this.temperature)) {
      const Product = mongoose.model('Product');
      const p = await Product.findById(this.product).select('dimension density temperature').lean();
      if (p) {
        if (!this.dimension && p.dimension) this.dimension = p.dimension;
        if (!this.densityRef && p.density) this.densityRef = p.density;
        if (!this.temperature && p.temperature) this.temperature = p.temperature;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Basic indexes for reporting
QCCheckSchema.index({ mo: 1, createdAt: 1 });
QCCheckSchema.index({ campaign: 1, createdAt: 1 });
QCCheckSchema.index({ product: 1, type: 1, createdAt: 1 });
QCCheckSchema.index({ type: 1, result: 1, createdAt: 1 });

export default mongoose.model('QCCheck', QCCheckSchema);