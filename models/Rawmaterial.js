import mongoose from 'mongoose';

const { Schema } = mongoose;

const RawMaterialSchema = new Schema({
    // Name of the raw material (e.g., "Alumina", "Silica", "Organic Binder")
    productName: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    // The unit in which you measure this raw material
    UOM: {
        type: String,
        required: true,
    },
    // The current quantity of this raw material in your inventory
    currentStock: {
        type: Number,
        required: true,
        default: 0
    },
    // The purchase price of the raw material
    purchasePrice: {
        type: Number,
        required: true,
        default: 0
    },
    // Minimum stock level before restocking is needed
    minimumStock: {
        type: Number,
        required: true,
        default: 0
    },
    // Optional: A unique SKU for the raw material for easy identification
    sku: {
        type: String,
        unique: true,
        trim: true
    },
    // Optional: Any additional notes or description
    description: {
        type: String
    }
}, { timestamps: true });

RawMaterialSchema.pre('save', async function(next) {
    if (!this.sku) {
        const prefix = 'RAW-' + this.productName.substring(0, 3).toUpperCase() + '-';
        let serial = 1;
        let skuCandidate = prefix + serial.toString().padStart(3, '0');

        // Check for existing SKUs and increment serial until unique
        while (await mongoose.models.RawMaterial.findOne({ sku: skuCandidate })) {
            serial++;
            skuCandidate = prefix + serial.toString().padStart(3, '0');
        }

        this.sku = skuCandidate;
    }
    next();
});

export default mongoose.model('RawMaterial', RawMaterialSchema);