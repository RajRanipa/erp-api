// models/WorkOrder.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const WorkOrderSchema = new Schema({
    workOrderNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    // Reference to the specific product variant being produced
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantityToProduce: {
        type: Number,
        required: true,
        min: 1
    },
    unit: { // e.g., 'rolls', 'kg', 'units' - should match UOM
        type: String,
        required: true
    },
    currentStatus: {
        type: String,
        required: true,
        default: 'Pending',
        enum: [
            'Pending',
            'In Progress - Mixing',
            'In Progress - Melting',
            'In Progress - Spinning',
            'In Progress - Needling/Pressing',
            'In Progress - Heat Process',
            'In Progress - Cutting',
            'In Progress - Packing',
            'Complete',
            'On Hold',
            'Canceled'
        ]
    },
    // Array to track the status of each specific production step
    productionSteps: [{
        stepName: {
            type: String,
            required: true
        },
        status: {
            type: String,
            default: 'Pending',
            enum: ['Pending', 'In Progress', 'Complete', 'Skipped', 'On Hold']
        },
        startedAt: Date,
        completedAt: Date,
        notes: String
    }],
    // Materials consumed from inventory for this specific work order
    materialsConsumed: [{
        rawMaterial: {
            type: Schema.Types.ObjectId,
            ref: 'RawMaterial',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        }
    }],
    // Date when the work order was created and last updated
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('WorkOrder', WorkOrderSchema);