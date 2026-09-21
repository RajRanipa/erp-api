import mongoose from 'mongoose';

const { Schema } = mongoose;

const allocationSchema = new Schema({
  lotId: { type: Schema.Types.ObjectId, ref: 'InventoryLot', required: true },
  lotNo: { type: String, required: true },
  qualityStatus: { type: String, trim: true, uppercase: true, required: true },
  processStatus: { type: String, trim: true, uppercase: true, required: true },
  quantity: { type: Number, required: true },
  catchQuantity: { type: Number, default: null },
  unitCost: { type: Number, required: true, min: 0 },
  value: { type: Number, required: true, min: 0 },
}, { _id: false });

const entrySchema = new Schema({
  direction: { type: String, enum: ['IN', 'OUT'], required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  bin: { type: String, trim: true, default: null },
  qualityStatus: {
    type: String,
    enum: ['AVAILABLE', 'HOLD', 'REJECTED'],
    default: 'AVAILABLE',
  },
  processStatus: { type: String, trim: true, uppercase: true, default: 'AVAILABLE' },
  quantity: { type: Number, required: true, min: 0 },
  catchQuantity: { type: Number, min: 0, default: null },
  baseUom: { type: String, required: true, trim: true, lowercase: true },
  catchUom: { type: String, trim: true, lowercase: true, default: null },
  unitCost: { type: Number, required: true, min: 0, default: 0 },
  value: { type: Number, required: true, min: 0, default: 0 },
  lotId: { type: Schema.Types.ObjectId, ref: 'InventoryLot', default: null },
  lotNo: { type: String, trim: true, default: null },
  allocations: { type: [allocationSchema], default: [] },
  serialIds: [{ type: Schema.Types.ObjectId, ref: 'InventorySerial' }],
}, { _id: false });

const inventoryTransactionSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  transactionNo: { type: String, required: true, trim: true, uppercase: true },
  type: {
    type: String,
    enum: ['RECEIPT', 'ISSUE', 'TRANSFER', 'CONVERSION', 'ADJUSTMENT', 'QUALITY_CHANGE'],
    required: true,
    index: true,
  },
  status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED', index: true },
  idempotencyKey: { type: String, trim: true, required: true, maxlength: 240 },
  effectiveAt: { type: Date, default: Date.now, required: true, index: true },
  referenceType: { type: String, trim: true, uppercase: true, default: null },
  referenceId: { type: String, trim: true, default: null },
  reason: { type: String, trim: true, default: null, maxlength: 500 },
  authorizationReference: { type: String, trim: true, default: null, maxlength: 200 },
  note: { type: String, trim: true, default: '', maxlength: 2000 },
  entries: { type: [entrySchema], required: true },
  totalValueIn: { type: Number, min: 0, default: 0 },
  totalValueOut: { type: Number, min: 0, default: 0 },
  processMetrics: {
    inputWeightKg: { type: Number, min: 0, default: null },
    outputWeightKg: { type: Number, min: 0, default: null },
    processLossKg: { type: Number, default: null },
    yieldPercent: { type: Number, min: 0, default: null },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reversalOf: { type: Schema.Types.ObjectId, ref: 'InventoryTransaction', default: null },
}, { timestamps: true, versionKey: false });

inventoryTransactionSchema.index(
  { companyId: 1, transactionNo: 1 },
  { unique: true, name: 'uniq_company_inventory_transaction_no' },
);
inventoryTransactionSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_company_inventory_idempotency' },
);
inventoryTransactionSchema.index({ companyId: 1, effectiveAt: -1, _id: -1 });
inventoryTransactionSchema.index({ companyId: 1, 'entries.itemId': 1, effectiveAt: -1 });

for (const operation of [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]) {
  inventoryTransactionSchema.pre(operation, function rejectMutation() {
    if (this.getOptions()?.context !== 'inventoryReversal') {
      throw new Error('Posted inventory transactions are immutable; post a reversal instead.');
    }
  });
}

inventoryTransactionSchema.pre('save', function rejectExistingSave() {
  if (!this.isNew) {
    throw new Error('Posted inventory transactions are immutable; post a reversal instead.');
  }
});

export default mongoose.models.InventoryTransaction
  || mongoose.model('InventoryTransaction', inventoryTransactionSchema, 'inventorytransactions');
