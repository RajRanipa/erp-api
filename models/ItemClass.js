import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ITEM_CLASS_CODES = Object.freeze([
  'PURCHASED_MATERIAL',
  'PACKAGING',
  'COMPONENT',
  'INTERMEDIATE',
  'FINISHED_GOOD',
  'BY_PRODUCT',
  'CONSUMABLE',
  'SPARE',
  'SERVICE',
]);

const capabilitySchema = new Schema({
  inventory: { type: Boolean, default: true },
  purchasable: { type: Boolean, default: false },
  manufacturable: { type: Boolean, default: false },
  consumable: { type: Boolean, default: false },
  sellable: { type: Boolean, default: false },
}, { _id: false });

const itemClassSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  code: {
    type: String,
    enum: ITEM_CLASS_CODES,
    required: true,
    trim: true,
    uppercase: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  capabilities: { type: capabilitySchema, default: () => ({}) },
  system: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

itemClassSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, name: 'uniq_company_item_class_code' },
);
itemClassSchema.index({ companyId: 1, status: 1, name: 1 });

export default mongoose.models.ItemClass
  || mongoose.model('ItemClass', itemClassSchema);
