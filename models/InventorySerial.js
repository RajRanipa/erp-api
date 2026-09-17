import mongoose from 'mongoose';

const { Schema } = mongoose;

const traceSpecificationSchema = new Schema({
  code: { type: String, required: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },
  unit: { type: String, trim: true, lowercase: true, default: null },
}, { _id: false });

const traceSnapshotSchema = new Schema({
  manufacturerName: { type: String, trim: true, required: true },
  productName: { type: String, trim: true, required: true },
  sku: { type: String, trim: true, uppercase: true, required: true },
  campaignName: { type: String, trim: true, default: null },
  lotNo: { type: String, trim: true, uppercase: true, required: true },
  specifications: { type: [traceSpecificationSchema], default: [] },
}, { _id: false });

const inventorySerialSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true, index: true },
  lotId: { type: Schema.Types.ObjectId, ref: 'InventoryLot', required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
  serialNo: { type: String, required: true, trim: true, maxlength: 120 },
  legacySerialNo: { type: String, trim: true, uppercase: true, maxlength: 120, default: null },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
  bin: { type: String, trim: true, default: null },
  state: {
    type: String,
    enum: ['AVAILABLE', 'RESERVED', 'CONSUMED', 'SOLD', 'SPLIT', 'SCRAPPED'],
    default: 'AVAILABLE',
    index: true,
  },
  qualityStatus: {
    type: String,
    enum: ['ACCEPTED', 'HOLD', 'REJECTED'],
    default: 'ACCEPTED',
    index: true,
  },
  baseQuantity: { type: Number, required: true, min: 0, default: 1 },
  catchQuantity: { type: Number, min: 0, default: null },
  catchUom: { type: String, trim: true, lowercase: true, default: null },
  catchSource: {
    type: String,
    enum: ['PLC_PI', 'DERIVED', 'NOMINAL', 'MANUAL'],
    default: null,
  },
  manufacturedAt: { type: Date, default: null, index: true },
  measuredAt: { type: Date, default: null },
  manualReason: { type: String, trim: true, maxlength: 500, default: null },
  traceSnapshot: { type: traceSnapshotSchema, default: null },
  parentSerialId: { type: Schema.Types.ObjectId, ref: 'InventorySerial', default: null },
  sourceType: { type: String, trim: true, uppercase: true, default: null },
  sourceId: { type: String, trim: true, default: null },
}, { timestamps: true, optimisticConcurrency: true });

inventorySerialSchema.index(
  { serialNo: 1 },
  { unique: true, name: 'uniq_global_v2_inventory_serial' },
);
inventorySerialSchema.index(
  { companyId: 1, legacySerialNo: 1 },
  {
    unique: true,
    name: 'uniq_company_v2_legacy_inventory_serial',
    partialFilterExpression: { legacySerialNo: { $type: 'string' } },
  },
);
inventorySerialSchema.index({ companyId: 1, itemId: 1, state: 1, createdAt: 1 });
inventorySerialSchema.index({ companyId: 1, parentSerialId: 1 });

export default mongoose.models.InventorySerial
  || mongoose.model('InventorySerial', inventorySerialSchema, 'inventoryserialv2');
