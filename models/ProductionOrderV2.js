import mongoose from 'mongoose';

const { Schema } = mongoose;

const materialSnapshotSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true },
  plannedQuantity: { type: Number, required: true, min: 0 },
  issuedQuantity: { type: Number, min: 0, default: 0 },
  uom: { type: String, required: true, trim: true, lowercase: true },
  stage: { type: String, enum: ['RELEASE', 'PACKING'], default: 'RELEASE' },
}, { _id: false });

const operationSnapshotSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  sequence: { type: Number, required: true },
  inventoryProcessStatus: { type: String, trim: true, uppercase: true, default: null },
  status: {
    type: String,
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'],
    default: 'PENDING',
  },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const productionOrderV2Schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  orderNo: { type: String, required: true, trim: true, uppercase: true },
  outputItemId: { type: Schema.Types.ObjectId, ref: 'ItemMaster', required: true, index: true },
  recipeId: { type: Schema.Types.ObjectId, ref: 'ManufacturingRecipeV2', required: true },
  recipeRevision: { type: Number, required: true },
  plannedQuantity: { type: Number, required: true, min: 0.000001 },
  outputUom: { type: String, required: true, trim: true, lowercase: true },
  sourceWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  outputWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  status: {
    type: String,
    enum: ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'DRAFT',
    index: true,
  },
  materials: { type: [materialSnapshotSchema], default: [] },
  operations: { type: [operationSnapshotSchema], default: [] },
  materialIssueTransactionId: {
    type: Schema.Types.ObjectId,
    ref: 'InventoryTransactionV2',
    default: null,
  },
  materialValue: { type: Number, min: 0, default: 0 },
  actualOutputQuantity: { type: Number, min: 0, default: 0 },
  rejectedQuantity: { type: Number, min: 0, default: 0 },
  outputLotIds: [{ type: Schema.Types.ObjectId, ref: 'InventoryLotV2' }],
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, optimisticConcurrency: true });

productionOrderV2Schema.index(
  { companyId: 1, orderNo: 1 },
  { unique: true, name: 'uniq_company_v2_production_order_no' },
);
productionOrderV2Schema.index({ companyId: 1, status: 1, createdAt: -1 });
productionOrderV2Schema.index({ companyId: 1, outputItemId: 1, createdAt: -1 });

export default mongoose.models.ProductionOrderV2
  || mongoose.model('ProductionOrderV2', productionOrderV2Schema);
