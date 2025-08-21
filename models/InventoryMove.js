

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * InventoryMove — single source of truth for stock movements.
 *
 * We always record positive `qty`. Direction is implied by `fromLocation` → `toLocation`.
 * Examples:
 *  - ISSUE_TO_MO:   RAW → WIP
 *  - RETURN_FROM_MO: WIP → RAW (or MAIN)
 *  - FINISHED_RECEIPT: WIP → FINISHED (usually status 'Plastic' for blankets)
 *  - PACK_UPGRADE: FINISHED(Plastic) → FINISHED(Plastic+Woven|Plastic+Box)
 *  - SCRAP: Any → SCRAP (or a scrap logical location)
 *  - BYPRODUCT: WIP → FINISHED (for offcuts usable in board)
 *  - MELT_RETURN: WIP → SHORTS (melt that didn’t become fiber)
 */

export const MOVE_TYPES = [
  'RECEIPT',          // purchase or opening balance into RAW/MAIN
  'ISSUE_TO_MO',      // consume raw to MO
  'RETURN_FROM_MO',   // return unused raw from MO
  'FINISHED_RECEIPT', // receive FG from MO
  'PACK_UPGRADE',     // change packing status & consume packing
  'SCRAP',            // write to scrap
  'BYPRODUCT',        // usable offcuts/by-products
  'MELT_RETURN',      // melt sent back to shorts room
];

export const LOCATIONS = [
  'RAW',
  'WIP',
  'FINISHED',
  'DISPATCH',
  'SHORTS',    // shorts room (cool-down melt store)
  'SCRAP_BIN', // logical scrap area
  'MAIN',      // generic/default if you don’t separate yet
];

export const PACK_STATUSES = [
  'Plastic',
  'Plastic+Woven',
  'Plastic+Box',
];

const InventoryMoveSchema = new Schema({
  date: { type: Date, default: Date.now },

  type: { type: String, enum: MOVE_TYPES, required: true },

  // What moved
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  qty: { type: Number, required: true, min: 0 }, // positive numbers only
  uom: { type: String, required: true },

  // Blanket classification (optional for non-blanket products)
  dimension: { type: Schema.Types.ObjectId, ref: 'Dimension' },
  density: { type: Schema.Types.ObjectId, ref: 'Density' },
  temperature: { type: Schema.Types.ObjectId, ref: 'Temperature' },

  // Packaging status (only meaningful for blankets as finished goods)
  status: { type: String, enum: PACK_STATUSES },

  // Locations
  fromLocation: { type: String, enum: LOCATIONS, default: 'MAIN' },
  toLocation:   { type: String, enum: LOCATIONS, default: 'MAIN' },

  // References
  mo: { type: Schema.Types.ObjectId, ref: 'ManufacturingOrder' },
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },

  notes: { type: String, trim: true },
}, { timestamps: true });

// Basic sanity: qty must be > 0
InventoryMoveSchema.pre('validate', function(next) {
  if (!(this.qty > 0)) {
    return next(new Error('InventoryMove.qty must be > 0'));
  }
  next();
});

// in InventoryMove.js
InventoryMoveSchema.pre('save', async function(next) {
  try {
    // If any snapshot field is missing, hydrate once from Product
    if ((!this.dimension || !this.density || !this.temperature) && this.product) {
      const Product = mongoose.model('Product');
      const p = await Product.findById(this.product).select('dimension density temperature').lean();
      if (p) {
        if (!this.dimension && p.dimension) this.dimension = p.dimension;
        if (!this.density && p.density) this.density = p.density;
        if (!this.temperature && p.temperature) this.temperature = p.temperature;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Helpful indexes for reporting and speed
InventoryMoveSchema.index({ date: 1 });
InventoryMoveSchema.index({ type: 1, date: 1 });
InventoryMoveSchema.index({ product: 1, date: 1 });
InventoryMoveSchema.index({ mo: 1, date: 1 });
InventoryMoveSchema.index({ campaign: 1, date: 1 });
// Query how many rolls by temp/density/dimension and packing
InventoryMoveSchema.index({ product: 1, temperature: 1, density: 1, dimension: 1, status: 1 });
// Fast filter by locations
InventoryMoveSchema.index({ fromLocation: 1, toLocation: 1, date: 1 });

export default mongoose.model('InventoryMove', InventoryMoveSchema);