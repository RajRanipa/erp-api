import mongoose from 'mongoose';
import {
  ProcurementAddressSchema,
  ProcurementAuditSchema,
  ProcurementTotalsSchema,
  moneyField,
  quantityField,
} from './procurementSchemas.js';

const { Schema } = mongoose;

export const PURCHASE_ORDER_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
});

const PurchaseOrderLineSchema = new Schema({
  lineNumber: { type: Number, required: true, min: 1 },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: { type: String, required: true, trim: true, maxlength: 160 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 80, default: '' },
  categoryKey: {
    type: String,
    enum: ['RAW', 'PACKING', 'FG'],
    required: true,
  },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  orderedQty: quantityField,
  uom: { type: String, required: true, trim: true, lowercase: true, maxlength: 30 },
  unitPrice: moneyField,
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  taxPercent: { type: Number, default: 0, min: 0, max: 100 },
  hsnCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: '' },
  receivedQty: { ...quantityField, required: false, default: 0 },
  acceptedQty: { ...quantityField, required: false, default: 0 },
  rejectedQty: { ...quantityField, required: false, default: 0 },
  quarantinedQty: { ...quantityField, required: false, default: 0 },
  returnedQty: { ...quantityField, required: false, default: 0 },
  invoicedQty: { ...quantityField, required: false, default: 0 },
  subtotal: moneyField,
  discountAmount: moneyField,
  taxableAmount: moneyField,
  taxAmount: moneyField,
  lineTotal: moneyField,
}, { _id: true });

const PurchaseOrderSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
  },
  poNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 50,
  },
  supplierId: {
    type: Schema.Types.ObjectId,
    ref: 'Party',
    required: true,
  },
  supplierSnapshot: {
    code: { type: String, trim: true, maxlength: 40, default: '' },
    name: { type: String, trim: true, maxlength: 200, required: true },
    taxId: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
  },
  warehouseId: {
    type: Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true,
  },
  orderDate: { type: Date, required: true, default: Date.now },
  expectedDeliveryDate: { type: Date, default: null },
  currency: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3,
    default: 'INR',
  },
  paymentTerms: {
    type: { type: String, enum: ['DUE_ON_RECEIPT', 'NET_DAYS', 'CUSTOM'], default: 'NET_DAYS' },
    netDays: { type: Number, min: 0, max: 3650, default: 30 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
  },
  deliveryAddress: { type: ProcurementAddressSchema, default: () => ({}) },
  lines: {
    type: [PurchaseOrderLineSchema],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length > 0 && value.length <= 200,
      message: 'A purchase order requires between 1 and 200 lines',
    },
  },
  totals: { type: ProcurementTotalsSchema, required: true, default: () => ({}) },
  freight: moneyField,
  otherCharges: moneyField,
  roundOff: { type: Number, default: 0 },
  status: {
    type: String,
    enum: Object.values(PURCHASE_ORDER_STATUS),
    default: PURCHASE_ORDER_STATUS.DRAFT,
  },
  notes: { type: String, trim: true, maxlength: 5000, default: '' },
  terms: { type: String, trim: true, maxlength: 10000, default: '' },
  internalReference: { type: String, trim: true, maxlength: 120, default: '' },
  statusHistory: { type: [ProcurementAuditSchema], default: [] },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  closedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

PurchaseOrderSchema.index(
  { companyId: 1, poNumber: 1 },
  { unique: true, name: 'uniq_company_purchase_order_number' },
);
PurchaseOrderSchema.index({ companyId: 1, status: 1, orderDate: -1, _id: -1 });
PurchaseOrderSchema.index({ companyId: 1, supplierId: 1, orderDate: -1 });
PurchaseOrderSchema.index({ companyId: 1, warehouseId: 1, status: 1 });
PurchaseOrderSchema.index({ companyId: 1, 'lines.itemId': 1, status: 1 });
PurchaseOrderSchema.index({ companyId: 1, expectedDeliveryDate: 1, status: 1 });

export default mongoose.model('PurchaseOrder', PurchaseOrderSchema);
