import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
  {
    sku: { type: String, unique: true, required: true },
    productName: { type: String, required: true, trim: true },
    productType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductType',
      required: true
    },

    // Core parameters that define a unique product variant
    temperature: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Temperature',
      required: true,
    },
    density: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Density',
      // Validation for density is handled by partial unique indexes below.
      required: false,
    },
    dimension: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dimension',
      // Validation for dimension is handled by partial unique indexes below.
      required: false,
    },
    packingType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PackingMaterial',
      required: true,
    },

    // Financial and stock-related fields
    purchasePrice: { type: Number, default: 0 },
    salePrice: { type: Number, default: 0 },
    product_unit: { type: String, required: true },
    currentStock: { type: Number, default: 0 },
    minimumStock: { type: Number, default: 0 },
    description: { type: String },
  },
  { timestamps: true }
);

// We cannot index subfields of referenced documents (ObjectId refs), so we use partial unique indexes
// to enforce uniqueness constraints based on the presence/absence of dimension and density references.
// This ensures correct uniqueness for both "bulk" and non-bulk product variants.
ProductSchema.index(
  { productType: 1, dimension: 1, density: 1, temperature: 1, packingType: 1 },
  { unique: true, partialFilterExpression: { dimension: { $exists: true }, density: { $exists: true } } }
);

ProductSchema.index(
  { productType: 1, temperature: 1, packingType: 1 },
  { unique: true, partialFilterExpression: { dimension: { $exists: false }, density: { $exists: false } } }
);

export default mongoose.model('Product', ProductSchema);