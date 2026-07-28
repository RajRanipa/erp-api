import mongoose from 'mongoose';

const { Schema } = mongoose;

export const moneyField = {
  type: Number,
  default: 0,
  min: 0,
  validate: {
    validator: Number.isFinite,
    message: 'Amount must be a finite number',
  },
};

export const quantityField = {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: Number.isFinite,
    message: 'Quantity must be a finite number',
  },
};

export const ProcurementAuditSchema = new Schema({
  action: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 80,
  },
  fromStatus: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
  toStatus: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, { _id: true });

export const ProcurementTotalsSchema = new Schema({
  subtotal: moneyField,
  discountTotal: moneyField,
  taxableTotal: moneyField,
  taxTotal: moneyField,
  freight: moneyField,
  otherCharges: moneyField,
  roundOff: {
    type: Number,
    default: 0,
    validate: {
      validator: Number.isFinite,
      message: 'Round-off must be a finite number',
    },
  },
  grandTotal: moneyField,
}, { _id: false });

export const ProcurementAddressSchema = new Schema({
  label: { type: String, trim: true, maxlength: 80, default: '' },
  line1: { type: String, trim: true, maxlength: 240, default: '' },
  line2: { type: String, trim: true, maxlength: 240, default: '' },
  city: { type: String, trim: true, maxlength: 100, default: '' },
  state: { type: String, trim: true, maxlength: 100, default: '' },
  country: { type: String, trim: true, maxlength: 100, default: 'India' },
  pincode: { type: String, trim: true, maxlength: 24, default: '' },
}, { _id: false });
