import mongoose from 'mongoose';
import {
  ProcurementAuditSchema,
  ProcurementTotalsSchema,
  moneyField,
  quantityField,
} from './procurementSchemas.js';

const { Schema } = mongoose;

export const PURCHASE_INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  VERIFIED: 'VERIFIED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
});

const PurchaseInvoiceLineSchema = new Schema({
  poLineId: { type: Schema.Types.ObjectId, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: { type: String, required: true, trim: true, maxlength: 160 },
  invoicedQty: quantityField,
  uom: { type: String, required: true, trim: true, lowercase: true, maxlength: 30 },
  unitPrice: moneyField,
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  taxPercent: { type: Number, default: 0, min: 0, max: 100 },
  subtotal: moneyField,
  discountAmount: moneyField,
  taxableAmount: moneyField,
  taxAmount: moneyField,
  lineTotal: moneyField,
}, { _id: true });

const InvoiceVarianceSchema = new Schema({
  lineId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
  type: {
    type: String,
    enum: ['QUANTITY', 'PRICE', 'MISSING_RECEIPT', 'OTHER'],
    required: true,
  },
  expected: { type: Number, default: 0 },
  actual: { type: Number, default: 0 },
  message: { type: String, trim: true, maxlength: 500, required: true },
}, { _id: true });

const PurchaseInvoiceSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
  },
  invoiceNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 50,
  },
  supplierInvoiceNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 120,
  },
  purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  goodsReceiptIds: [{ type: Schema.Types.ObjectId, ref: 'GoodsReceipt' }],
  supplierId: { type: Schema.Types.ObjectId, ref: 'Party', required: true },
  invoiceDate: { type: Date, required: true, default: Date.now },
  dueDate: { type: Date, default: null },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3,
    default: 'INR',
  },
  lines: {
    type: [PurchaseInvoiceLineSchema],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length > 0 && value.length <= 200,
      message: 'A purchase invoice requires between 1 and 200 lines',
    },
  },
  totals: { type: ProcurementTotalsSchema, required: true, default: () => ({}) },
  freight: moneyField,
  otherCharges: moneyField,
  roundOff: { type: Number, default: 0 },
  matchStatus: {
    type: String,
    enum: ['NOT_CHECKED', 'MATCHED', 'VARIANCE'],
    default: 'NOT_CHECKED',
  },
  variances: { type: [InvoiceVarianceSchema], default: [] },
  status: {
    type: String,
    enum: Object.values(PURCHASE_INVOICE_STATUS),
    default: PURCHASE_INVOICE_STATUS.DRAFT,
  },
  notes: { type: String, trim: true, maxlength: 5000, default: '' },
  statusHistory: { type: [ProcurementAuditSchema], default: [] },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  paidAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

PurchaseInvoiceSchema.index(
  { companyId: 1, invoiceNumber: 1 },
  { unique: true, name: 'uniq_company_purchase_invoice_number' },
);
PurchaseInvoiceSchema.index(
  { companyId: 1, supplierId: 1, supplierInvoiceNumber: 1 },
  { unique: true, name: 'uniq_company_supplier_invoice_number' },
);
PurchaseInvoiceSchema.index({ companyId: 1, status: 1, invoiceDate: -1, _id: -1 });
PurchaseInvoiceSchema.index({ companyId: 1, purchaseOrderId: 1, invoiceDate: -1 });
PurchaseInvoiceSchema.index({ companyId: 1, dueDate: 1, status: 1 });

export default mongoose.model('PurchaseInvoice', PurchaseInvoiceSchema);
