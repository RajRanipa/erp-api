
// backend-api/models/InventoryLedger.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * InventoryLedger
 * Append-only movement records for stock changes.
 * Positive quantity increases on-hand; negative quantity decreases on-hand.
 * Use alongside InventorySnapshot for fast balance reads.
 */
const InventoryLedgerSchema = new Schema(
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
      index: true,
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

    // Base UOM preferred (e.g., 'pcs', 'kg', 'roll')
    uom: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Quantity delta for this movement.
     * +qty for RECEIPT / TRANSFER-IN / ADJUST+
     * -qty for ISSUE / TRANSFER-OUT / ADJUST-
     */
    quantity: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isFinite,
        message: 'Quantity must be a finite number',
      },
    },

    txnType: {
      type: String,
      required: true,
      enum: ['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUST', 'REPACK'],
      index: true,
    },

    // Optional cross-module reference
    refType: { type: String, default: null, trim: true }, // e.g., 'PO','SO','PROD','MANUAL'
    refId: { type: String, default: null, trim: true },

    note: { type: String, default: '', trim: true },

    // Who performed this movement
    by: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    // Effective time of movement (defaults to now)
    at: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true, // createdAt, updatedAt (do not mutate existing rows)
    versionKey: false,
  }
);

// Helpful compound indexes for common queries
InventoryLedgerSchema.index({
  companyId: 1,
  itemId: 1,
  warehouseId: 1,
  batchNo: 1,
  bin: 1,
  at: -1,
});

InventoryLedgerSchema.index({ companyId: 1, at: -1 });
InventoryLedgerSchema.index({ companyId: 1, txnType: 1, at: -1 });

/**
 * Safety: Prevent accidental updates after insert.
 * Ledger rows should be immutable; allow only creation.
 */
InventoryLedgerSchema.pre('findOneAndUpdate', function disallowUpdate() {
  // console.log('InventoryLedger pre findOneAndUpdate');
  // eslint-disable-next-line no-param-reassign
  const err = new Error('InventoryLedger rows are immutable. Insert a new row instead.');
  // Allow explicit override via option { runValidators: false, context: 'allowUpdate' } if you really must.
  if (this.getOptions()?.context !== 'allowUpdate') {
    throw err;
  }
});

/**
 * Static helper to insert a movement (strongly typed interface).
 * Accepts positive or negative qty; you should decide sign in the caller.
 */
InventoryLedgerSchema.statics.record = async function recordMovement(doc, options = {}) {
  // console.log('InventoryLedger pre findOneAndUpdate');
  const Model = this;
  return Model.create([doc], options).then(([row]) => row);
};

const InventoryLedger = mongoose.model('InventoryLedger', InventoryLedgerSchema);
export default InventoryLedger;