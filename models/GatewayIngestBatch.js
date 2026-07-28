import mongoose from "mongoose";
const { Schema } = mongoose;

const GatewayIngestBatchSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    gatewayId: { type: String, required: true, index: true },
    clientBatchId: { type: String, trim: true, maxlength: 128 },
    contractVersion: { type: String, trim: true, maxlength: 20 },

    sentAt: { type: Date },
    receivedAt: { type: Date, default: Date.now },

    recordsCount: { type: Number, default: 0 },

    // store exact payload (industrial audit)
    rawPayload: { type: Schema.Types.Mixed, required: true },

    processingStatus: {
      type: String,
      enum: ["RECEIVED", "PROCESSED", "PARTIAL", "FAILED"],
      default: "RECEIVED",
      index: true,
    },
    processingSummary: {
      received: { type: Number, default: 0 },
      inserted: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      postedToInventory: { type: Number, default: 0 },
      inventorySkipped: { type: Number, default: 0 },
      inventoryPending: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      errors: [{ type: String }],
      warnings: [{ type: String }],
      recordResults: [{
        _id: false,
        recordId: { type: String },
        scaleNo: { type: Number },
        accepted: { type: Boolean, default: false },
        retryable: { type: Boolean, default: true },
        storageStatus: { type: String },
        inventoryStatus: { type: String },
        code: { type: String },
        message: { type: String },
      }],
    },
  },
  { timestamps: true }
);

GatewayIngestBatchSchema.index(
  { companyId: 1, gatewayId: 1, clientBatchId: 1 },
  {
    name: "idx_gateway_client_batch",
    partialFilterExpression: { clientBatchId: { $type: "string" } },
  }
);

export default mongoose.model("GatewayIngestBatch", GatewayIngestBatchSchema);
