

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * BOM — Bill of Materials for a finished/semi-finished product.
 *
 * v1: keep one active BOM per product (unique on `product`).
 * If you need revisions later, we can relax the unique
 * and add { product, revision } or effectivity ranges.
 */

const BomItemSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Product', required: true }, // raw or semi-finished component
  qtyPer: { type: Number, required: true, min: 0 },                      // quantity per 1 finished unit
  uom: { type: String, required: true },                                 // must be compatible/convertible with item.product_unit
  scrapPct: { type: Number, default: 0, min: 0, max: 100 },              // optional component scrap %
  notes: { type: String, trim: true },
}, { _id: false });

const BomSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true }, // product this BOM builds

  revision: { type: String, default: 'v1' },            // future-proofing
  effectiveFrom: { type: Date },                        // optional effectivity window
  effectiveTo:   { type: Date },

  items: { type: [BomItemSchema], default: [], validate: v => Array.isArray(v) },

  yieldPct: { type: Number, default: 100, min: 0, max: 100 },    // overall expected yield for the BOM

  // For blanket products: plastic bag is default consumption during MO completion (backflushed)
  includePlasticByDefault: { type: Boolean, default: true },

  // Optional cached/material cost (can be recomputed periodically)
  stdMaterialCost: { type: Number, default: 0, min: 0 },

  notes: { type: String, trim: true },
}, { timestamps: true });

// Indexes to speed up common queries
BomSchema.index({ product: 1 });
BomSchema.index({ revision: 1 });
BomSchema.index({ effectiveFrom: 1, effectiveTo: 1 });

export default mongoose.model('Bom', BomSchema);