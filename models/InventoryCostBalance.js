import mongoose from 'mongoose';

const { Schema } = mongoose;

const inventoryCostBalanceSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true, index: true },
  quantity: { type: Number, min: 0, default: 0 },
  inventoryValue: { type: Number, min: 0, default: 0 },
  movingAverageCost: { type: Number, min: 0, default: 0 },
  currency: { type: String, trim: true, uppercase: true, default: 'INR' },
}, { timestamps: true, versionKey: false });

inventoryCostBalanceSchema.index(
  { companyId: 1, itemId: 1 },
  { unique: true, name: 'uniq_company_item_cost_balance' },
);

export default mongoose.models.InventoryCostBalance
  || mongoose.model('InventoryCostBalance', inventoryCostBalanceSchema);
