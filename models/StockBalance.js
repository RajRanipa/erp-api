// models/StockBalance.js
import mongoose, { Schema } from 'mongoose';
const StockBalanceSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true, index: true },
  warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
  onHand: { type: Number, default: 0 },     // kg
  reserved: { type: Number, default: 0 },
  available: { type: Number, default: 0 },
  avgCost: { type: Number, default: 0 },
}, { timestamps: true });
StockBalanceSchema.index({ item:1, warehouse:1 }, { unique: true });
export default mongoose.model('StockBalance', StockBalanceSchema);