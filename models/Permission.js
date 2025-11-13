// backend-api/models/Permission.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Permission documents define a single capability (e.g., 'items:read').
 * Each permission can be assigned to one or more roles via the `roles` array.
 *
 * Migrating from /config/rolePermissions.js:
 *  - Create Permission docs for each `key` you used before.
 *  - For each permission, add the roles that should include it.
 *  - Then update your roleAuth middleware to read permissions from DB.
 */
const PermissionSchema = new Schema(
  {
    // e.g. 'items:read', 'inventory:receipt'
    key: { type: String, unique: true, required: true, trim: true, default:'users:permissions:read' },

    // Optional human readable label
    label: { type: String, trim: true },

    /**
     * Roles that include this permission.
     * Example: ['owner', 'manager', 'store_operator']
     */
    roles: {
      type: [String],
      default: [],
      index: true,
      // keep this list aligned with your supported roles
      enum: [
        'owner',
        'manager',
        'store_operator',
        'production_manager',
        'accountant',
        'investor',
      ],
    },
  },
  { timestamps: true }
);

// Unique constraint for permission keys
// PermissionSchema.index({ key: 1 }, { unique: true });
// // Fast lookup of permissions by role
// PermissionSchema.index({ roles: 1 });

/**
 * Static helper: returns an array of permission keys for a given role.
 * Example: const keys = await Permission.getKeysForRole('manager');
 */
PermissionSchema.statics.getKeysForRole = async function (role) {
  if (!role) return [];
  const rows = await this.find({ roles: role }).select({ key: 1, _id: 0 }).lean();
  return rows.map((r) => r.key);
};

export default mongoose.model('Permission', PermissionSchema);