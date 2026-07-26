import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Append-only audit trail for reservation changes. Reservation quantities do
 * not change physical on-hand stock, so they are deliberately kept separate
 * from InventoryLedger.
 */
const InventoryReservationEventSchema = new Schema({
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
  warehouseId: {
    type: Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true,
    index: true,
  },
  categoryKey: {
    type: String,
    enum: ['FG', 'RAW', 'PACKING', 'NC'],
    required: true,
  },
  productType: {
    type: Schema.Types.ObjectId,
    ref: 'ProductType',
    default: null,
  },
  bin: { type: String, default: null, trim: true },
  batchNo: { type: String, default: null, trim: true },
  uom: { type: String, required: true, trim: true, lowercase: true },
  quantity: {
    type: Number,
    required: true,
    validate: {
      validator: value => Number.isFinite(value) && value !== 0,
      message: 'Reservation quantity must be finite and non-zero',
    },
  },
  eventType: {
    type: String,
    enum: ['RESERVE', 'RELEASE'],
    required: true,
    index: true,
  },
  idempotencyKey: {
    type: String,
    default: null,
    trim: true,
    maxlength: 240,
  },
  refType: { type: String, default: null, trim: true },
  refId: { type: String, default: null, trim: true },
  note: { type: String, default: '', trim: true, maxlength: 2000 },
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, {
  timestamps: true,
  versionKey: false,
});

InventoryReservationEventSchema.index(
  { companyId: 1, at: -1, _id: -1 },
  { name: 'reservation_history' },
);
InventoryReservationEventSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: 'uniq_inventory_reservation_idempotency',
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

for (const operation of [
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]) {
  InventoryReservationEventSchema.pre(operation, function disallowMutation() {
    if (this.getOptions()?.context !== 'inventoryMigration') {
      throw new Error(
        'InventoryReservationEvent rows are immutable. Post a release instead.',
      );
    }
  });
}

InventoryReservationEventSchema.pre('save', function disallowExistingEventSave() {
  if (!this.isNew) {
    throw new Error(
      'InventoryReservationEvent rows are immutable. Post a release instead.',
    );
  }
});

export default mongoose.model(
  'InventoryReservationEvent',
  InventoryReservationEventSchema,
);
