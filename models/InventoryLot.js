import mongoose from 'mongoose';

const { Schema } = mongoose;

const packagingComponentSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true },
  quantity: { type: Number, required: true, min: 0.000001 },
  uom: { type: String, required: true, trim: true, lowercase: true },
}, { _id: false });

const inventoryLotSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  itemId: {
    type: Schema.Types.ObjectId,
    ref: 'ItemMaster',
    required: true,
    immutable: true,
    index: true,
  },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
  warehouseId: {
    type: Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true,
    index: true,
  },
  bin: { type: String, trim: true, default: null },
  lotNo: { type: String, required: true, trim: true, uppercase: true, maxlength: 100 },
  qualityStatus: {
    type: String,
    enum: ['AVAILABLE', 'HOLD', 'REJECTED'],
    default: 'AVAILABLE',
    index: true,
  },
  processStatus: {
    type: String,
    enum: [
      'AVAILABLE',
      'DRAWN',
      'DRYING',
      'DRIED_AWAITING_QC',
      'EDGED',
      'PACKED',
      'REJECTED',
    ],
    default: 'AVAILABLE',
    index: true,
  },
  receivedAt: { type: Date, required: true, default: Date.now, index: true },
  manufacturedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  supplierPartyId: { type: Schema.Types.ObjectId, ref: 'Party', default: null },
  supplierLotNo: { type: String, trim: true, default: null, maxlength: 120 },
  originalQuantity: { type: Number, required: true, min: 0 },
  onHandQuantity: { type: Number, required: true, min: 0, default: 0 },
  reservedQuantity: { type: Number, min: 0, default: 0 },
  originalCatchQuantity: { type: Number, min: 0, default: null },
  onHandCatchQuantity: { type: Number, min: 0, default: null },
  baseUom: { type: String, required: true, trim: true, lowercase: true },
  catchUom: { type: String, trim: true, lowercase: true, default: null },
  unitCost: { type: Number, required: true, min: 0, default: 0 },
  remainingValue: { type: Number, required: true, min: 0, default: 0 },
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED'],
    default: 'OPEN',
    index: true,
  },
  sourceType: { type: String, trim: true, uppercase: true, default: null },
  sourceId: { type: String, trim: true, default: null },
  parentLotIds: [{ type: Schema.Types.ObjectId, ref: 'InventoryLot' }],
  packingLabel: { type: String, trim: true, maxlength: 180, default: null },
  packingKey: { type: String, trim: true, uppercase: true, maxlength: 240, default: null },
  packagingComponents: { type: [packagingComponentSchema], default: [] },
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

inventoryLotSchema.index(
  { companyId: 1, itemId: 1, warehouseId: 1, lotNo: 1 },
  { unique: true, name: 'uniq_inventory_lot_location' },
);
inventoryLotSchema.index({
  companyId: 1,
  itemId: 1,
  warehouseId: 1,
  qualityStatus: 1,
  status: 1,
  receivedAt: 1,
});
inventoryLotSchema.index({ companyId: 1, packingKey: 1, status: 1 });

export default mongoose.models.InventoryLot
  || mongoose.model('InventoryLot', inventoryLotSchema, 'inventorylots');
