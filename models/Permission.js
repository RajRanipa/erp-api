// backend-api/models/Permission.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const PermissionSchema = new Schema(
  {
    key: { type: String, unique: true, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    module: { type: String, required: true, trim: true, index: true },
    system: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'deprecated'], default: 'active', index: true },
  },
  { timestamps: true }
);

PermissionSchema.index({ module: 1, key: 1 });

export default mongoose.models.Permission || mongoose.model('Permission', PermissionSchema);
