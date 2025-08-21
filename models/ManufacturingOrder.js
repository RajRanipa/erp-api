

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * ManufacturingOrder — MO for making either Blanket rolls or Bulk fiber bags.
 *
 * v1 decisions (approved by Raj):
 *  - Separate MOs for Bulk vs Blanket (no multi-output in one MO for now)
 *  - Backflush RAW + Plastic at completion for Blanket; Woven/Box are manual upgrades
 *  - Keep rolls unserialized (store aggregate qty + optional total weight)
 */

export const MO_STATUSES = [
  'PLANNED',
  'RELEASED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
];

// Material line exploded from BOM at MO creation (frozen requirements)
const MoMaterialSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  requiredQty: { type: Number, required: true, min: 0 },
  issuedQty: { type: Number, default: 0, min: 0 },
  uom: { type: String, required: true },
  notes: { type: String, trim: true },
}, { _id: false, timestamps: false });

// Output summary captured at completion
const MoOutputSchema = new Schema({
  kind: { type: String, enum: ['BLANKET_ROLL', 'BULK_BAG'], required: true },
  qty: { type: Number, default: 0, min: 0 },           // pcs
  weightKgTotal: { type: Number, default: 0, min: 0 }, // optional aggregate
}, { _id: false, timestamps: false });

const ManufacturingOrderSchema = new Schema({
  // Optional grouping to campaigns
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },

  // What we are producing (either a Blanket product or Bulk fiber product)
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },

  // Planned quantity and UoM for the MO (pcs for both rolls and bulk bags)
  qty: { type: Number, required: true, min: 0 },
  uom: { type: String, required: true },

  // Freeze the BOM used to explode materials (reference for traceability)
  bom: { type: Schema.Types.ObjectId, ref: 'Bom', required: true },

  status: { type: String, enum: MO_STATUSES, default: 'PLANNED' },
  dueDate: { type: Date },

  // Frozen material requirements (from BOM). For Raj's current process, raw is
  // not in BOM yet; plastic bag may be implied via includePlasticByDefault.
  materials: { type: [MoMaterialSchema], default: [] },

  // Captured on completion
  outputs: { type: [MoOutputSchema], default: [] },

  // Optional notes and audit helpers
  notes: { type: String, trim: true },
}, { timestamps: true });

// Sanity validation
ManufacturingOrderSchema.pre('validate', function(next) {
  if (!(this.qty >= 0)) return next(new Error('MO.qty must be >= 0'));
  if (!this.uom) return next(new Error('MO.uom is required'));
  next();
});

// Helpful indexes
ManufacturingOrderSchema.index({ status: 1, dueDate: 1 });
ManufacturingOrderSchema.index({ product: 1, status: 1 });
ManufacturingOrderSchema.index({ campaign: 1, status: 1 });
ManufacturingOrderSchema.index({ createdAt: 1 });

export default mongoose.model('ManufacturingOrder', ManufacturingOrderSchema);