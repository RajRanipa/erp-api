import mongoose from 'mongoose';

const { Schema } = mongoose;

const capabilitySchema = new Schema({
  inventory: { type: Boolean, default: true },
  purchasable: { type: Boolean, default: false },
  manufacturable: { type: Boolean, default: false },
  consumable: { type: Boolean, default: false },
  sellable: { type: Boolean, default: false },
}, { _id: false });

const attributeRuleSchema = new Schema({
  attributeId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemAttributeDefinition',
    required: true,
  },
  required: { type: Boolean, default: false },
  identity: { type: Boolean, default: false },
  searchable: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  defaultValue: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const itemFamilySchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  itemClassId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemClass',
    required: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 40,
  },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1200, default: '' },
  capabilities: { type: capabilitySchema, default: () => ({}) },
  attributeRules: { type: [attributeRuleSchema], default: [] },
  uomPolicy: {
    baseUom: { type: String, required: true, trim: true, lowercase: true },
    catchUom: { type: String, trim: true, lowercase: true, default: null },
    catchMode: {
      type: String,
      enum: ['NONE', 'MEASURED', 'DERIVED', 'NOMINAL'],
      default: 'NONE',
    },
    nominalFactor: { type: Number, min: 0, default: null },
  },
  trackingPolicy: {
    lotTracked: { type: Boolean, default: true },
    serialTracked: { type: Boolean, default: false },
    serialControlMode: {
      type: String,
      enum: ['NONE', 'INFORMATIONAL', 'REQUIRED'],
      default: 'NONE',
    },
    expiryTracked: { type: Boolean, default: false },
  },
  skuPrefix: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
  version: { type: Number, min: 1, default: 1 },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'draft',
    index: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

itemFamilySchema.index(
  { companyId: 1, code: 1 },
  { unique: true, name: 'uniq_company_item_family_code' },
);
itemFamilySchema.index({ companyId: 1, itemClassId: 1, status: 1, name: 1 });

export default mongoose.models.ItemFamily
  || mongoose.model('ItemFamily', itemFamilySchema);
