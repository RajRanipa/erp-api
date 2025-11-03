import mongoose from 'mongoose';

const { Schema } = mongoose;

// Helpers for Decimal <-> Number
const toNumber = (v) => (v != null ? Number(v) : v);
const toDecimal = (v) => (v != null ? mongoose.Types.Decimal128.fromString(String(v)) : v);

const ProductSchema = new Schema(
  {
    sku: { type: String, unique: true, required: true, trim: true },
    productName: { type: String, required: true, trim: true },

    productType: { type: Schema.Types.ObjectId, ref: 'ProductType', required: true },

    // Core parameters that define a unique variant
    temperature: { type: Schema.Types.ObjectId, ref: 'Temperature', required: true },
    density:     { type: Schema.Types.ObjectId, ref: 'Density', default: null },   // optional for non-bulk
    dimension:   { type: Schema.Types.ObjectId, ref: 'Dimension', default: null }, // optional for non-bulk

    packingType: { type: Schema.Types.ObjectId, ref: 'PackingMaterial', required: true },

    // Financial & stock
    purchasePrice: { type: Schema.Types.Decimal128, default: 0, get: toNumber, set: toDecimal },
    salePrice:     { type: Schema.Types.Decimal128, default: 0, get: toNumber, set: toDecimal },

    product_unit: {
      type: String,
      required: true,
      trim: true,
      // enum: ['pcs','kg','m','box'] // <- add if you can standardize
    },

    currentStock:  { type: Number, default: 0, min: 0 },
    minimumStock:  { type: Number, default: 0, min: 0 },

    description:   { type: String, trim: true },

    // Nice-to-have audit fields (optional)
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isArchived: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

/**
 * Conditional required examples (uncomment/adjust if needed)
 * E.g., if certain product types mandate density/dimension:
 *
 * ProductSchema.path('density').required(function () {
 *   return Boolean(this.productTypeRequiresDensity); // implement lookup by productType if needed
 * });
 * ProductSchema.path('dimension').required(function () {
 *   return Boolean(this.productTypeRequiresDimension);
 * });
 */

// --- Indexes ---

// Uniqueness when BOTH density and dimension are present (ObjectIds)
ProductSchema.index(
  { productType: 1, temperature: 1, density: 1, dimension: 1, packingType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      density: { $type: 'objectId' },
      dimension: { $type: 'objectId' },
    },
  }
);

// Uniqueness when BOTH density and dimension are ABSENT (null)
ProductSchema.index(
  { productType: 1, temperature: 1, packingType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      density: null,
      dimension: null,
    },
  }
);

// Quick lookups
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index({ productName: 1, productType: 1 });

// --- Virtuals ---
ProductSchema.virtual('inStock').get(function () {
  return (this.currentStock ?? 0) > 0;
});
ProductSchema.virtual('lowStock').get(function () {
  const min = this.minimumStock ?? 0;
  const cur = this.currentStock ?? 0;
  return cur > 0 && cur <= min;
});

// --- Validation (business rules) ---
ProductSchema.pre('validate', function (next) {
  // Example: ensure salePrice >= purchasePrice if both set
  const buy = this.purchasePrice != null ? Number(this.purchasePrice) : 0;
  const sell = this.salePrice != null ? Number(this.salePrice) : 0;
  if (sell < 0 || buy < 0) {
    return next(new Error('Prices cannot be negative'));
  }
  next();
});

export default mongoose.model('Product', ProductSchema);

// Optional SKU auto-gen if you sometimes omit sku on create
// ProductSchema.pre('validate', async function (next) {
//   if (this.sku) return next();
//   // generate from attributes (simplified)
//   const parts = [
//     'SKU',
//     (this.productName || '').slice(0, 4).toUpperCase(),
//     String(this.temperature || '').slice(-4),
//     this.density ? 'D' : 'ND',
//     this.dimension ? 'DIM' : 'NODIM',
//   ].filter(Boolean);
//   this.sku = parts.join('-');
//   next();
// });


// import mongoose from 'mongoose';

// const ProductSchema = new mongoose.Schema(
//   {
//     sku: { type: String, unique: true, required: true },
//     productName: { type: String, required: true, trim: true },
//     productType: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'ProductType',
//       required: true
//     },

//     // Core parameters that define a unique product variant
//     temperature: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Temperature',
//       required: true,
//     },
//     density: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Density',
//       // Validation for density is handled by partial unique indexes below.
//       required: false,
//     },
//     dimension: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Dimension',
//       // Validation for dimension is handled by partial unique indexes below.
//       required: false,
//     },
//     packingType: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'PackingMaterial',
//       required: true,
//     },

//     // Financial and stock-related fields
//     purchasePrice: { type: Number, default: 0 },
//     salePrice: { type: Number, default: 0 },
//     product_unit: { type: String, required: true },
//     currentStock: { type: Number, default: 0 },
//     minimumStock: { type: Number, default: 0 },
//     description: { type: String },
//   },
//   { timestamps: true }
// );

// // We cannot index subfields of referenced documents (ObjectId refs), so we use partial unique indexes
// // to enforce uniqueness constraints based on the presence/absence of dimension and density references.
// // This ensures correct uniqueness for both "bulk" and non-bulk product variants.
// ProductSchema.index(
//   { productType: 1, dimension: 1, density: 1, temperature: 1, packingType: 1 },
//   { unique: true, partialFilterExpression: { dimension: { $exists: true }, density: { $exists: true } } }
// );

// ProductSchema.index(
//   { productType: 1, temperature: 1, packingType: 1 },
//   { unique: true, partialFilterExpression: { dimension: { $exists: false }, density: { $exists: false } } }
// );

// export default mongoose.model('Product', ProductSchema);