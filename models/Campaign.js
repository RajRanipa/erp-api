


import mongoose from 'mongoose';

const campaignSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    status: {
      type: String,
      enum: ["PLANNED", "RUNNING", "COMPLETED"],
      default: "PLANNED"
    },
    totalRawIssued: { type: Number, default: 0 }, // in kg
    totalFiberProduced: { type: Number, default: 0 }, // bulk + blanket + rejects
    meltReturns: { type: Number, default: 0 }, // kg of melt returned
    remarks: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }, {
  timestamps: true
}
);

campaignSchema.index({ status: 1 });
campaignSchema.index({ startDate: 1 });

export default mongoose.model('Campaign', campaignSchema);