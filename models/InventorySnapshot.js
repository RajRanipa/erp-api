// backend-api/models/InventorySnapshot.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * InventorySnapshot
 * One document per (companyId, itemId, warehouseId, bin?, batchNo?, uom).
 * Holds the *current* stock levels for fast reads.
 *
 * - onHand:    physical quantity present
 * - reserved:  quantity allocated to open orders / production
 * - available: computed (onHand - reserved)
 *
 * Use alongside InventoryLedger (append-only) for audit/history.
 */
const InventorySnapshotSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    itemId: {
      type: Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true,
    },

    categoryKey: {
      type: String,
      enum: ['FG', 'RAW', 'PACKING', 'NC'],
      required: true,
      index: true,
    },

    productType: {
      type: Schema.Types.ObjectId, 
      ref: 'ProductType',
      default: null,
    },

    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
      index: true,
    },

    // Optional bin/shelf within a warehouse
    bin: {
      type: String,
      default: null,
      trim: true,
    },

    // Optional batch/lot number
    batchNo: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },

    // Store balances in a *base* unit where possible (e.g., pcs/kg/roll)
    uom: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    onHand: {
      type: Number,
      default: 0,
      min: 0,
    },

    reserved: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Redundant for fast reads; maintained by hooks/helpers
    available: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Unique key per stock bucket.
 * Product type/category are metadata, not identity. Item is the canonical
 * inventory identity, so changing denormalized metadata cannot split stock.
 */
InventorySnapshotSchema.index(
  { companyId: 1, itemId: 1, warehouseId: 1, bin: 1, batchNo: 1, uom: 1 },
  { unique: true, name: 'uniq_bucket' }
);

// Helpful secondary indexes
InventorySnapshotSchema.index({ companyId: 1, itemId: 1, warehouseId: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, itemId: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, warehouseId: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, categoryKey: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, productType: 1, available: -1 });

/**
 * Keep `available` in sync automatically.
 */
InventorySnapshotSchema.pre('save', function recomputeAvailable(next) {
  this.available = (this.onHand ?? 0) - (this.reserved ?? 0);
  next();
});

/**
 * Atomic helpers
 * Use these statics from services/controllers to update balances safely.
 */
InventorySnapshotSchema.statics.incOnHand = async function (
  { companyId, itemId, categoryKey, productType = null, warehouseId, uom, bin = null, batchNo = null },
  qty,
  session,
  { enforceNonNegative = true } = {},
) {
  const Model = this;
  const filter = { companyId, itemId, warehouseId, bin, batchNo, uom };
  if (qty < 0 && enforceNonNegative) {
    const decrease = Math.abs(qty);
    filter.onHand = { $gte: decrease };
    filter.available = { $gte: decrease };
  }
  const update = {
    $inc: { onHand: qty, available: qty },
    $set: { categoryKey, productType },
    $setOnInsert: {
      companyId, itemId, warehouseId, bin, batchNo, uom,
      reserved: 0,
    },
  };
  const options = {
    upsert: qty > 0,
    new: true,
    runValidators: true,
  };
  if (session) options.session = session;

  const doc = await Model.findOneAndUpdate(filter, update, options);
  return doc;
};

InventorySnapshotSchema.statics.incReserved = async function (
  { companyId, itemId, categoryKey, productType = null, warehouseId, uom, bin = null, batchNo = null },
  qty,
  session
) {
  const Model = this;
  const filter = { companyId, itemId, warehouseId, bin, batchNo, uom };
  if (qty > 0) {
    filter.available = { $gte: qty };
  } else if (qty < 0) {
    filter.reserved = { $gte: Math.abs(qty) };
  }
  const update = {
    $inc: { reserved: qty, available: -qty },
    $set: { categoryKey, productType },
  };
  const options = { upsert: false, new: true, runValidators: true };
  if (session) options.session = session;

  const doc = await Model.findOneAndUpdate(filter, update, options);
  return doc;
};

const InventorySnapshot = mongoose.model('InventorySnapshot', InventorySnapshotSchema);
export default InventorySnapshot;
