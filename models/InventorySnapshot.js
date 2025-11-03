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
    
    productType: {
      type: Schema.Types.ObjectId, 
      ref: 'ProductType',
      required: true,
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
    },

    onHand: {
      type: Number,
      default: 0,
    },

    reserved: {
      type: Number,
      default: 0,
    },

    // Redundant for fast reads; maintained by hooks/helpers
    available: {
      type: Number,
      default: 0,
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
 * Note: Include uom so mixed-UOM items don't collide.
 */
InventorySnapshotSchema.index(
  { companyId: 1, itemId: 1, productType: 1, warehouseId: 1, bin: 1, batchNo: 1, uom: 1 },
  { unique: true, name: 'uniq_bucket' }
);

// Helpful secondary indexes
InventorySnapshotSchema.index({ companyId: 1, itemId: 1, warehouseId: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, itemId: 1, available: -1 });
InventorySnapshotSchema.index({ companyId: 1, warehouseId: 1, available: -1 });

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
  { companyId, itemId, productType, warehouseId, uom, bin = null, batchNo = null },
  qty,
  session
) {
  const Model = this;
  const filter = { companyId, itemId, productType, warehouseId, bin, batchNo, uom };
  const update = {
    $inc: { onHand: qty },
    $setOnInsert: {
      // identity fields only; do NOT set `onHand` here to avoid conflict with $inc
      companyId, itemId, productType, warehouseId, bin, batchNo, uom,
      reserved: 0,
    },
  };
  const options = { upsert: true, new: true };
  if (session) options.session = session;

  const doc = await Model.findOneAndUpdate(filter, update, options);
  doc.available = (doc.onHand ?? 0) - (doc.reserved ?? 0);
  await doc.save({ session });
  return doc;
};

InventorySnapshotSchema.statics.incReserved = async function (
  { companyId, itemId, productType, warehouseId, uom, bin = null, batchNo = null },
  qty,
  session
) {
  const Model = this;
  const filter = { companyId, itemId, productType, warehouseId, bin, batchNo, uom };
  const update = {
    $inc: { reserved: qty },
    $setOnInsert: {
      // identity fields only; do NOT set `reserved` here to avoid conflict with $inc
      companyId, itemId, productType, warehouseId, bin, batchNo, uom,
      onHand: 0,
    },
  };
  const options = { upsert: true, new: true };
  if (session) options.session = session;

  const doc = await Model.findOneAndUpdate(filter, update, options);
  doc.available = (doc.onHand ?? 0) - (doc.reserved ?? 0);
  await doc.save({ session });
  return doc;
};

const InventorySnapshot = mongoose.model('InventorySnapshot', InventorySnapshotSchema);
export default InventorySnapshot;