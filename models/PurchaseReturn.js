import mongoose from 'mongoose';
import { ProcurementAuditSchema, quantityField } from './procurementSchemas.js';

const { Schema } = mongoose;

export const PURCHASE_RETURN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
});

const PurchaseReturnLineSchema = new Schema({
  goodsReceiptLineId: { type: Schema.Types.ObjectId, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: { type: String, required: true, trim: true, maxlength: 160 },
  qty: quantityField,
  uom: { type: String, required: true, trim: true, lowercase: true, maxlength: 30 },
  batchNo: { type: String, trim: true, maxlength: 120, default: '' },
  bin: { type: String, trim: true, maxlength: 120, default: '' },
  reason: {
    type: String,
    enum: ['QUALITY_REJECTION', 'DAMAGED', 'EXCESS', 'WRONG_ITEM', 'OTHER'],
    default: 'QUALITY_REJECTION',
  },
  remarks: { type: String, trim: true, maxlength: 1000, default: '' },
  inventoryRequestId: { type: String, trim: true, maxlength: 240, default: '' },
}, { _id: true });

const PurchaseReturnSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
  },
  returnNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 50,
  },
  purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  goodsReceiptId: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Party', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  returnDate: { type: Date, required: true, default: Date.now },
  supplierCreditNoteNo: { type: String, trim: true, maxlength: 120, default: '' },
  lines: {
    type: [PurchaseReturnLineSchema],
    required: true,
    validate: {
      validator: value => Array.isArray(value) && value.length > 0 && value.length <= 200,
      message: 'A purchase return requires between 1 and 200 lines',
    },
  },
  status: {
    type: String,
    enum: Object.values(PURCHASE_RETURN_STATUS),
    default: PURCHASE_RETURN_STATUS.DRAFT,
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

PurchaseReturnSchema.index(
  { companyId: 1, returnNumber: 1 },
  { unique: true, name: 'uniq_company_purchase_return_number' },
);
PurchaseReturnSchema.index({ companyId: 1, status: 1, returnDate: -1, _id: -1 });
PurchaseReturnSchema.index({ companyId: 1, goodsReceiptId: 1, returnDate: -1 });
PurchaseReturnSchema.index({ companyId: 1, supplierId: 1, returnDate: -1 });

export default mongoose.model('PurchaseReturn', PurchaseReturnSchema);
