import mongoose from 'mongoose';

const { Schema } = mongoose;

const componentSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  uom: { type: String, required: true, trim: true, lowercase: true },
  scrapPercent: { type: Number, min: 0, max: 100, default: 0 },
  issueMethod: { type: String, enum: ['FIFO', 'MANUAL_LOT'], default: 'FIFO' },
  stage: { type: String, enum: ['RELEASE', 'PACKING'], default: 'RELEASE' },
}, { _id: false });

const byProductSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true },
  expectedQuantity: { type: Number, min: 0, default: 0 },
  costAllocationWeight: { type: Number, min: 0, default: 0 },
}, { _id: false });

const operationSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  sequence: { type: Number, required: true, min: 1 },
  inventoryProcessStatus: { type: String, trim: true, uppercase: true, default: null },
  quantityCapture: { type: Boolean, default: false },
  qualityGate: { type: Boolean, default: false },
}, { _id: false });

const manufacturingRecipeSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  outputItemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  revision: { type: Number, required: true, min: 1, default: 1 },
  status: {
    type: String,
    enum: ['DRAFT', 'ACTIVE', 'OBSOLETE'],
    default: 'DRAFT',
    index: true,
  },
  effectiveFrom: { type: Date, default: null },
  effectiveTo: { type: Date, default: null },
  basisQuantity: { type: Number, required: true, min: 0.000001, default: 1 },
  outputUom: { type: String, required: true, trim: true, lowercase: true },
  expectedYieldPercent: { type: Number, min: 0.01, max: 100, default: 100 },
  components: { type: [componentSchema], default: [] },
  byProducts: { type: [byProductSchema], default: [] },
  operations: { type: [operationSchema], default: [] },
  packingRule: {
    enabled: { type: Boolean, default: false },
    unitsPerPack: { type: Number, min: 0.000001, default: null },
    packItemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', default: null },
    packQuantity: { type: Number, min: 0.000001, default: null },
  },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, optimisticConcurrency: true });

manufacturingRecipeSchema.index(
  { companyId: 1, code: 1, revision: 1 },
  { unique: true, name: 'uniq_company_recipe_revision' },
);
manufacturingRecipeSchema.index(
  { companyId: 1, outputItemId: 1, status: 1 },
  {
    unique: true,
    name: 'uniq_active_recipe_per_output',
    partialFilterExpression: { status: 'ACTIVE' },
  },
);

export default mongoose.models.ManufacturingRecipe
  || mongoose.model('ManufacturingRecipe', manufacturingRecipeSchema, 'manufacturingrecipev2');
