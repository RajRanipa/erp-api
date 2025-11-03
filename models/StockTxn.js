// models/StockTxn.js
import mongoose, { Schema } from 'mongoose';
const StockTxnSchema = new Schema({
  ts: { type: Date, default: Date.now, index: true },
  item: { type: Schema.Types.ObjectId, ref: 'Item', index: true, required: true },
  warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', index: true, required: true },
  // + for receipts, - for issues
  qty: { type: Number, required: true },       // original qty (user UOM)
  uom: { type: String, default: 'kg' },
  qtyBase: { type: Number, required: true },   // normalized to kg, sign matches qty
  unitCost: { type: Number, default: 0 },      // for AVG, read from StockBalance at time of issue; for receipts, from GRN
  amount: { type: Number, default: 0 },        // qtyBase * unitCost (signed)
  refType: { type: String, enum: ['RECEIPT','BATCH_ISSUE','ADJUSTMENT','TRANSFER','SALE'], required: true },
  refId: { type: Schema.Types.ObjectId },
  campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  batch: { type: Schema.Types.ObjectId, ref: 'Batch' },
}, { timestamps: true });
StockTxnSchema.index({ item:1, warehouse:1, ts:1 });
export default mongoose.model('StockTxn', StockTxnSchema);