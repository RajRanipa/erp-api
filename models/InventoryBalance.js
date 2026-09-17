import mongoose from 'mongoose';

const { Schema } = mongoose;

const inventoryBalanceSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true, index: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
  bin: { type: String, trim: true, default: null },
  lotId: { type: Schema.Types.ObjectId, ref: 'InventoryLot', required: true, index: true },
  qualityStatus: {
    type: String,
    enum: ['AVAILABLE', 'HOLD', 'REJECTED'],
    required: true,
    default: 'AVAILABLE',
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
  },
  baseUom: { type: String, required: true, trim: true, lowercase: true },
  catchUom: { type: String, trim: true, lowercase: true, default: null },
  onHand: { type: Number, min: 0, default: 0 },
  reserved: { type: Number, min: 0, default: 0 },
  available: { type: Number, min: 0, default: 0 },
  catchOnHand: { type: Number, min: 0, default: null },
}, { timestamps: true, versionKey: false });

inventoryBalanceSchema.index(
  {
    companyId: 1,
    itemId: 1,
    warehouseId: 1,
    bin: 1,
    lotId: 1,
    qualityStatus: 1,
    processStatus: 1,
  },
  { unique: true, name: 'uniq_v2_inventory_balance_bucket' },
);
inventoryBalanceSchema.index({
  companyId: 1,
  warehouseId: 1,
  qualityStatus: 1,
  available: -1,
});

export default mongoose.models.InventoryBalance
  || mongoose.model('InventoryBalance', inventoryBalanceSchema, 'inventorybalancev2');
