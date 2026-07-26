import mongoose from 'mongoose';

const batchesSchema = new mongoose.Schema(
  {
    batche_id: { type: String, required: true, trim: true, unique: true },
    date: { type: Date, required: true },
    numbersBatches: { type: Number, required: true, min: 1 },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },
    rawMaterials: [
      {
        itemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Item',
          required: true,
        },
        weight: { type: Number, required: true, min: 0.000001 },
        unit: { type: String, default: 'kg' },
        issuedQuantity: { type: Number, required: true, min: 0.000001 },
        issuedUom: { type: String, required: true },
        inventoryAllocations: [
          {
            quantity: { type: Number, required: true, min: 0.000001 },
            uom: { type: String, required: true, trim: true, lowercase: true },
            bin: { type: String, default: null, trim: true },
            batchNo: { type: String, default: null, trim: true },
            snapshotId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'InventorySnapshot',
              default: null,
            },
            ledgerId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'InventoryLedger',
              default: null,
            },
          },
        ],
      }
    ],
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

// Useful indices
batchesSchema.index({ createdBy: 1, date: -1 });
batchesSchema.index({ companyId: 1, campaign: 1, date: -1 });
batchesSchema.index({ companyId: 1, warehouseId: 1, date: -1 });

export default mongoose.model('Batch', batchesSchema);
