import mongoose from "mongoose";
const { Schema } = mongoose;

const ProductionBlanketRollSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    gatewayId: { type: String, required: true, index: true },

    recordId: { type: Number, required: true },
    at: { type: Date, required: true, index: true },

    // Raw fields from PLC
    productCode: { type: Number, required: true },
    temperatureValue: { type: Number, required: true },
    densityValue: { type: Number, required: true },
    sizeCode: { type: Number, required: true },

    batchNo: { type: String, default: "" },

    scaleNo: { type: Number, required: true },
    weightKg: { type: Number, required: true },

    // normalized bool
    statusOk: { type: Boolean, required: true, index: true },

    // resolved references
    productType: { type: Schema.Types.ObjectId, ref: "ProductType" },
    temperature: { type: Schema.Types.ObjectId, ref: "Temperature" },
    density: { type: Schema.Types.ObjectId, ref: "Density" },
    dimension: { type: Schema.Types.ObjectId, ref: "Dimension" },
    packingItem: { type: Schema.Types.ObjectId, ref: "Item" },
    matchedItem: { type: Schema.Types.ObjectId, ref: "Item" },

    resolveErrors: [{ type: String }],

    // inventory linkage
    inventoryPosted: { type: Boolean, default: false, index: true },
    inventoryRef: {
      ledgerId: { type: Schema.Types.ObjectId, ref: "InventoryLedger" },
      snapshotId: { type: Schema.Types.ObjectId, ref: "InventorySnapshot" },
    },

    ingestBatchId: { type: Schema.Types.ObjectId, ref: "GatewayIngestBatch" },
  },
  { timestamps: true }
);

// Idempotency key: recordId + scaleNo is unique per gateway
ProductionBlanketRollSchema.index(
  { companyId: 1, gatewayId: 1, recordId: 1, scaleNo: 1 },
  { unique: true }
);

export default mongoose.model("ProductionBlanketRoll", ProductionBlanketRollSchema);