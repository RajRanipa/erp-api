import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ITEM_MASTER_STATUSES = Object.freeze([
  'draft',
  'in_review',
  'returned',
  'approved',
  'active',
  'blocked',
  'archived',
]);

const attributeValueSchema = new Schema({
  attributeId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemAttributeDefinition',
    required: true,
  },
  code: { type: String, required: true, trim: true, lowercase: true },
  dataType: {
    type: String,
    enum: ['text', 'number', 'boolean', 'date', 'select', 'reference'],
    required: true,
  },
  valueString: { type: String, trim: true, default: null },
  valueNumber: { type: Number, default: null },
  valueBoolean: { type: Boolean, default: null },
  valueDate: { type: Date, default: null },
  valueRef: { type: Schema.Types.ObjectId, default: null },
  normalizedValue: { type: String, required: true, trim: true, maxlength: 240 },
  displayValue: { type: String, required: true, trim: true, maxlength: 240 },
  unit: { type: String, trim: true, lowercase: true, default: null },
}, { _id: false });

const capabilitySchema = new Schema({
  inventory: { type: Boolean, default: true },
  purchasable: { type: Boolean, default: false },
  manufacturable: { type: Boolean, default: false },
  consumable: { type: Boolean, default: false },
  sellable: { type: Boolean, default: false },
}, { _id: false });

const statusHistorySchema = new Schema({
  from: { type: String, enum: ITEM_MASTER_STATUSES, default: null },
  to: { type: String, enum: ITEM_MASTER_STATUSES, required: true },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const itemMasterSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  familyId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemFamily',
    required: true,
    index: true,
  },
  itemClassId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemClass',
    required: true,
    index: true,
  },
  sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  attributes: { type: [attributeValueSchema], default: [] },
  attributeFingerprint: {
    type: String,
    required: true,
    maxlength: 1200,
  },
  searchText: { type: String, trim: true, lowercase: true, default: '', select: false },
  searchTokens: { type: [String], default: [], select: false },
  baseUom: { type: String, required: true, trim: true, lowercase: true },
  catchUom: { type: String, trim: true, lowercase: true, default: null },
  catchMode: {
    type: String,
    enum: ['NONE', 'MEASURED', 'DERIVED', 'NOMINAL'],
    default: 'NONE',
  },
  nominalFactor: { type: Number, min: 0, default: null },
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
  capabilities: { type: capabilitySchema, default: () => ({}) },
  minimumStock: { type: Number, min: 0, default: 0 },
  status: {
    type: String,
    enum: ITEM_MASTER_STATUSES,
    default: 'draft',
    index: true,
  },
  statusHistory: { type: [statusHistorySchema], default: [] },
  legacyItemId: {
    type: Schema.Types.ObjectId,
    ref: 'Item',
    default: null,
    index: true,
  },
  schemaVersion: { type: Number, default: 2, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

itemMasterSchema.index(
  { companyId: 1, sku: 1 },
  { unique: true, name: 'uniq_company_item_master_sku' },
);
itemMasterSchema.index(
  { companyId: 1, familyId: 1, attributeFingerprint: 1 },
  { unique: true, name: 'uniq_company_family_attribute_identity' },
);
itemMasterSchema.index(
  { companyId: 1, legacyItemId: 1 },
  {
    unique: true,
    name: 'uniq_company_legacy_item_mapping',
    partialFilterExpression: { legacyItemId: { $type: 'objectId' } },
  },
);
itemMasterSchema.index({ companyId: 1, status: 1, familyId: 1, name: 1 });
itemMasterSchema.index({ companyId: 1, itemClassId: 1, status: 1, name: 1 });
itemMasterSchema.index({ companyId: 1, searchText: 1 });
itemMasterSchema.index({ companyId: 1, searchTokens: 1, status: 1 });
itemMasterSchema.index({ companyId: 1, _id: -1 });
itemMasterSchema.index({ companyId: 1, searchTokens: 1, _id: -1 });

export default mongoose.models.ItemMaster
  || mongoose.model('ItemMaster', itemMasterSchema);
