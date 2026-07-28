import mongoose from 'mongoose';
import { ProcurementAuditSchema, quantityField } from './procurementSchemas.js';

const { Schema } = mongoose;

export const GOODS_RECEIPT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
});

export const INSPECTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  PARTIAL: 'PARTIAL',
});

const GoodsReceiptLineSchema = new Schema({
  poLineId: { type: Schema.Types.ObjectId, required: true },
  lineNumber: { type: Number, required: true, min: 1 },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: { type: String, required: true, trim: true, maxlength: 160 },
  uom: { type: String, required: true, trim: true, lowercase: true, maxlength: 30 },
  orderedQty: quantityField,
  previouslyReceivedQty: { ...quantityField, required: false, default: 0 },
  receivedQty: quantityField,
  acceptedQty: { ...quantityField, required: false, default: 0 },
  rejectedQty: { ...quantityField, required: false, default: 0 },
  quarantinedQty: { ...quantityField, required: false, default: 0 },
  quarantineAcceptedQty: { ...quantityField, required: false, default: 0 },
  quarantineRejectedQty: { ...quantityField, required: false, default: 0 },
  returnedQty: { ...quantityField, required: false, default: 0 },
  inspectionStatus: {
    type: String,
    enum: Object.values(INSPECTION_STATUS),
    default: INSPECTION_STATUS.PENDING,
  },
  supplierBatchNo: { type: String, trim: true, maxlength: 120, default: '' },
  batchNo: { type: String, trim: true, maxlength: 120, default: '' },
  bin: { type: String, trim: true, maxlength: 120, default: '' },
  manufacturedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  remarks: { type: String, trim: true, maxlength: 1000, default: '' },
  inventoryPostedQty: { ...quantityField, required: false, default: 0 },
  inventoryRequestId: { type: String, trim: true, maxlength: 240, default: '' },
  inspectionResolvedAt: { type: Date, default: null },
  inspectionResolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true });

const GoodsReceiptSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
  },
  grnNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 50,
  },
  purchaseOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true,
  },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Party', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  receivedAt: { type: Date, required: true, default: Date.now },
  supplierInvoiceNo: { type: String, trim: true, maxlength: 120, default: '' },
  deliveryChallanNo: { type: String, trim: true, maxlength: 120, default: '' },
  vehicleNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
  transporterName: { type: String, trim: true, maxlength: 160, default: '' },
  lines: {
    type: [GoodsReceiptLineSchema],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length > 0 && value.length <= 200,
      message: 'A goods receipt requires between 1 and 200 lines',
    },
  },
  status: {
    type: String,
    enum: Object.values(GOODS_RECEIPT_STATUS),
    default: GOODS_RECEIPT_STATUS.DRAFT,
  },
  notes: { type: String, trim: true, maxlength: 5000, default: '' },
  statusHistory: { type: [ProcurementAuditSchema], default: [] },
  postedAt: { type: Date, default: null },
  postedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

GoodsReceiptSchema.index(
  { companyId: 1, grnNumber: 1 },
  { unique: true, name: 'uniq_company_goods_receipt_number' },
);
GoodsReceiptSchema.index({ companyId: 1, status: 1, receivedAt: -1, _id: -1 });
GoodsReceiptSchema.index({ companyId: 1, purchaseOrderId: 1, receivedAt: -1 });
GoodsReceiptSchema.index({ companyId: 1, supplierId: 1, receivedAt: -1 });
GoodsReceiptSchema.index({ companyId: 1, 'lines.itemId': 1, receivedAt: -1 });
GoodsReceiptSchema.index({ companyId: 1, 'lines.batchNo': 1 });

export default mongoose.model('GoodsReceipt', GoodsReceiptSchema);
