// models/WorkOrder.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const WorkOrderSchema = new Schema({
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    campaign: {
        type: Schema.Types.ObjectId,
        ref: 'Campaign'
    },
    sourceWarehouseId: {
        type: Schema.Types.ObjectId,
        ref: 'Warehouse',
        required: true
    },
    outputWarehouseId: {
        type: Schema.Types.ObjectId,
        ref: 'Warehouse'
    },
    outputInventoryPosted: {
        type: Boolean,
        default: false
    },
    workOrderNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    // Reference to the specific product variant being produced
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Item',
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
        item: {
            type: Schema.Types.ObjectId,
            ref: 'Item',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        uom: { type: String, required: true }
    }],
}, { timestamps: true });

WorkOrderSchema.index({ companyId: 1, currentStatus: 1, createdAt: -1 });

export default mongoose.model('WorkOrder', WorkOrderSchema);
