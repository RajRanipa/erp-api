// models/RePackingLog.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const RePackingLogSchema = new Schema({
    // Reference to the specific product that was re-packed
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    // The quantity of the product that was re-packed
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    // The unit of measure for the quantity (e.g., 'rolls', 'kg')
    unit: {
        type: String,
        required: true
    },
    // The original packing status (e.g., 'Plastic Bag')
    originalPackingStatus: {
        type: String,
        required: true,
        enum: ['Plastic Bag'] // For blankets, this is typically 'Plastic Bag'
    },
    // The new packing status (e.g., 'Woven Bag', 'Box')
    newPackingStatus: {
        type: String,
        required: true,
        enum: ['Woven Bag', 'Box'] // Based on customer requirement
    },
    // The cost associated with this re-packing operation (e.g., manpower, new packaging material cost)
    repackingCost: {
        type: Number,
        default: 0
    },
    // Optional: Reference to the customer order that triggered this re-packing
    // This would require a 'SalesOrder' schema in the future
    customerOrder: {
        type: String // Placeholder for now, could be Schema.Types.ObjectId later
    },
    // Timestamp for when the re-packing occurred
    repackedAt: {
        type: Date,
        default: Date.now
    },
    // Optional: User who performed the re-packing
    repackedBy: {
        type: String // Placeholder for now, could be Schema.Types.ObjectId later for a 'User' model
    },
    notes: {
        type: String
    }
}, { timestamps: true });

export default mongoose.model('RePackingLog', RePackingLogSchema);