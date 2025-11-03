// backend-api/models/Permission.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const PermissionSchema = new Schema({
  key: { type: String, unique: true, required: true, trim: true }, // e.g. 'items:read'
  label: { type: String, trim: true },
}, { timestamps: true });

PermissionSchema.index({ key: 1 }, { unique: true });
export default mongoose.model('Permission', PermissionSchema);