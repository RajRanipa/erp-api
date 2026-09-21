import mongoose from "mongoose";
const { Schema } = mongoose;

const ProductionBlanketRollSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    gatewayId: { type: String, required: true, index: true },

    recordId: { type: String, required: true },
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

    // Final Item Master and inventory linkage.
    inventoryPosted: { type: Boolean, default: false, index: true },
    inventoryStatus: {
      type: String,
      enum: ["PENDING_MAPPING", "POSTED", "FAILED", "NOT_APPLICABLE"],
      default: "PENDING_MAPPING",
      index: true,
    },
    inventoryLastError: { type: String, default: null },
    inventoryLastAttemptAt: { type: Date, default: null, index: true },
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "ItemMaster",
      default: null,
      index: true,
    },
    inventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryTransaction",
      default: null,
    },
    inventorySerialId: {
      type: Schema.Types.ObjectId,
      ref: "InventorySerial",
      default: null,
      index: true,
    },
    inventorySerialNo: { type: String, default: null, index: true },

    ingestBatchId: { type: Schema.Types.ObjectId, ref: "GatewayIngestBatch" },
  },
  { timestamps: true }
);

// Idempotency key: recordId + scaleNo is unique per gateway
ProductionBlanketRollSchema.index(
  { companyId: 1, gatewayId: 1, recordId: 1, scaleNo: 1 },
  { unique: true }
);
ProductionBlanketRollSchema.index({
  inventoryPosted: 1,
  inventoryStatus: 1,
  inventoryLastAttemptAt: 1,
  at: -1,
});

export default mongoose.model("ProductionBlanketRoll", ProductionBlanketRollSchema);
