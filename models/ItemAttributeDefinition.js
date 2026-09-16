import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ATTRIBUTE_DATA_TYPES = Object.freeze([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'reference',
]);

const allowedValueSchema = new Schema({
  value: { type: String, required: true, trim: true, maxlength: 160 },
  label: { type: String, required: true, trim: true, maxlength: 160 },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { _id: false });

const attributeDefinitionSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 80,
  },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  dataType: {
    type: String,
    enum: ATTRIBUTE_DATA_TYPES,
    required: true,
  },
  unit: { type: String, trim: true, lowercase: true, default: null },
  referenceModel: { type: String, trim: true, default: null },
  referenceFamilyCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 40,
    default: null,
  },
  allowedValues: { type: [allowedValueSchema], default: [] },
  validation: {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    precision: { type: Number, min: 0, max: 8, default: null },
    pattern: { type: String, trim: true, default: null },
    maxLength: { type: Number, min: 1, max: 2000, default: null },
  },
  system: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

attributeDefinitionSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, name: 'uniq_company_item_attribute_code' },
);
attributeDefinitionSchema.index({ companyId: 1, status: 1, label: 1 });

export default mongoose.models.ItemAttributeDefinition
  || mongoose.model('ItemAttributeDefinition', attributeDefinitionSchema);
