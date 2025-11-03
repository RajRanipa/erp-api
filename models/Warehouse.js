// models/Warehouse.js
import mongoose, { Schema } from 'mongoose';

const WarehouseSchema = new Schema({
  code: { type: String, unique: true, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true },
  pincode: { type: String, trim: true },
  state: { type: String, trim: true },
}, { timestamps: true });

const Warehouse = mongoose.model('Warehouse', WarehouseSchema);
export default Warehouse;