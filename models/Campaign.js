


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
    totalBlanketRollsProduced: { type: Number, default: 0 }, // in rolls 
    totalBulkKgProduced: { type: Number, default: 0 }, // in kg
    totalFiberProduced: { type: Number, default: 0 }, // bulk + blanket + rejects in kg
    totalGoodFiberProduced: { type: Number, default: 0 }, // bulk + blanket in kg
    totalRejectedFiber: { type: Number, default: 0 }, // in kg
    meltReturns: { type: Number, default: 0 }, // kg of melt returned
    remarks: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }, {
  timestamps: true
}
);

campaignSchema.index({ startDate: 1 });

campaignSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "RUNNING"
    }
  }
);

export default mongoose.model('Campaign', campaignSchema);

// at one time i want only one campaign running is this possible ??