// models/Warehouse.js
import mongoose, { Schema } from 'mongoose';

const WarehouseSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    immutable: true,
    index: true,
  },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true },
  pincode: { type: String, trim: true },
  state: { type: String, trim: true },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

WarehouseSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, name: 'uniq_company_warehouse_code' },
);
WarehouseSchema.index({ companyId: 1, status: 1, name: 1 });

const Warehouse = mongoose.model('Warehouse', WarehouseSchema);
export default Warehouse;
