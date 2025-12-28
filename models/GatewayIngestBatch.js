import mongoose from "mongoose";
const { Schema } = mongoose;

const GatewayIngestBatchSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    gatewayId: { type: String, required: true, index: true },

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
      inserted: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      postedToInventory: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      errors: [{ type: String }],
    },
  },
  { timestamps: true }
);

export default mongoose.model("GatewayIngestBatch", GatewayIngestBatchSchema);