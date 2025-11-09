import mongoose from 'mongoose';

const dimensionSchema = new mongoose.Schema({
  length: { type: Number, required: true },
  width: { type: Number, required: true },
  thickness: { type: Number, required: true },
  unit: { type: String, required: true },
  unique: { type: String, default: 'no' }
}, { _id: false });

const packingMaterial = new mongoose.Schema({
  productType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductType',
    required: true,
    unique: false
  },
  productName: {
    type: String,
    required: true,
    trim: true,
  },
  UOM: {
    type: String,
    required: true
  },
  brandType: {
    type: String,
    enum: ['branded', 'plain'],
  },
  
  productColor: {
    type: String
  },
  currentStock: {
    type: Number,
    required: true,
    default: 0
  },
  purchasePrice: {
    type: Number,
    required: true,
    default: 0
  },
  minimumStock: {
    type: Number,
    required: true,
    default: 0
  },
dimension: {
    type: dimensionSchema,
  },
  description: {
    type: String
  }

}, { timestamps: true });

packingMaterial.index(
  { productType: 1, productName: 1, brandType: 1},
  { unique: true, partialFilterExpression: { brandType: { $exists: true } } }
);

packingMaterial.index(
  { productType: 1, productName: 1, brandType: 1, productColor: 1},
  { unique: true, partialFilterExpression: { brandType: { $exists: true }, productColor: { $exists: true } } }
);

packingMaterial.index(
  { productType: 1, productName: 1},
  { unique: true}
);

export default mongoose.model('PackingMaterial', packingMaterial);