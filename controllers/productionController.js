// controllers/productionController.js
import Product from '../models/Product.js';
import RawMaterial from '../models/Rawmaterial.js';
import BOM from '../models/BOM.js';
import Inventory from '../models/InventoryMove.js';
import WorkOrder from '../models/WorkOrder.js'; // Import the new WorkOrder model

export const createWorkOrder = async (req, res) => {
    try {
        const { productId, quantityToProduce, unit, workOrderNumber } = req.body;

        // Basic validation for required fields
        if (!productId || !quantityToProduce || !unit || !workOrderNumber) {
            return res.status(400).json({ message: 'Missing required fields: productId, quantityToProduce, unit, workOrderNumber.' });
        }

        // 1. Find the correct BOM for the product
        const bom = await BOM.findOne({ product: productId });
        if (!bom) {
            return res.status(404).json({ message: 'Bill of Materials (BOM) not found for the specified product.' });
        }

        // 2. Check raw material availability
        const materialsNeeded = [];
        for (const ingredient of bom.ingredients) {
            const inventoryItem = await Inventory.findOne({
                item: ingredient.rawMaterial,
                itemType: 'RawMaterial' // Ensure this matches the itemType in Inventory
            });

            // If raw material not found in inventory or insufficient quantity
            if (!inventoryItem || inventoryItem.quantity < ingredient.quantity) {
                const rawMaterial = await RawMaterial.findById(ingredient.rawMaterial);
                const rawMaterialName = rawMaterial ? rawMaterial.name : 'Unknown Raw Material';
                return res.status(400).json({
                    message: `Insufficient stock for raw material: ${rawMaterialName}. Needed: ${ingredient.quantity} ${ingredient.unit}, Have: ${inventoryItem ? inventoryItem.quantity : 0} ${ingredient.unit}.`
                });
            }
            materialsNeeded.push({
                rawMaterial: ingredient.rawMaterial,
                quantity: ingredient.quantity
            });
        }

        // 3. Deduct raw materials from inventory (perform this only if all checks pass)
        // Using a Promise.all for concurrent updates for efficiency
        await Promise.all(materialsNeeded.map(item =>
            Inventory.updateOne(
                { item: item.rawMaterial, itemType: 'RawMaterial' },
                { $inc: { quantity: -item.quantity } }
            )
        ));

        // Define all production steps as per your process
        const initialProductionSteps = [
            { stepName: 'Mixing', status: 'In Progress' }, // Start with Mixing
            { stepName: 'Melting', status: 'Pending' },
            { stepName: 'Spinning', status: 'Pending' },
            { stepName: 'Needling/Pressing', status: 'Pending' },
            { stepName: 'Heat Process', status: 'Pending' },
            { stepName: 'Cutting', status: 'Pending' },
            { stepName: 'Packing', status: 'Pending' }
        ];

        // 4. Create the new Work Order document
        const workOrder = new WorkOrder({
            workOrderNumber,
            product: productId,
            quantityToProduce,
            unit,
            currentStatus: 'In Progress - Mixing', // Initial status
            productionSteps: initialProductionSteps,
            materialsConsumed: materialsNeeded,
        });

        await workOrder.save();
        res.status(201).json({ message: 'Work order created successfully and raw materials deducted.', workOrder });

    } catch (error) {
        // Handle potential duplicate workOrderNumber or other database errors
        if (error.code === 11000) { // MongoDB duplicate key error
            return res.status(409).json({ message: 'Work Order Number already exists. Please use a unique number.' });
        }
        console.error('Error creating work order:', error);
        res.status(500).json({ message: 'Server error during work order creation.', error: error.message });
    }
};

// --- Controller to Fetch All Work Orders ---
export const getAllWorkOrders = async (req, res) => {
    try {
        // Find all work orders and populate the 'product' field
        // This will replace the product ObjectId with the actual product document,
        // allowing you to see product details directly.
        const workOrders = await WorkOrder.find().populate('product');
        res.status(200).json(workOrders);
    } catch (error) {
        console.error('Error fetching work orders:', error);
        res.status(500).json({ message: 'Server error while fetching work orders.', error: error.message });
    }
};

// --- Controller to Update a Work Order's Status ---
export const updateWorkOrder = async (req, res) => {
    try {
        const { id } = req.params; // Get the work order ID from the URL parameters
        const { newStatus, stepName, completedQuantity, isBulkProduct } = req.body; // New status and optional step details

        const workOrder = await WorkOrder.findById(id);

        if (!workOrder) {
            return res.status(404).json({ message: 'Work order not found.' });
        }

        // --- Logic to update specific production steps ---
        if (stepName) {
            const stepIndex = workOrder.productionSteps.findIndex(step => step.stepName === stepName);
            if (stepIndex > -1) {
                workOrder.productionSteps[stepIndex].status = newStatus;
                workOrder.productionSteps[stepIndex].completedAt = new Date(); // Mark completion time
            } else {
                return res.status(400).json({ message: `Production step '${stepName}' not found in this work order.` });
            }
        }

        // --- Logic for handling 'Complete' status and updating Inventory ---
        if (newStatus === 'Complete') {
            // Find the product details to get its type (blanket, bulk, etc.)
            const productDetails = await Product.findById(workOrder.product);
            if (!productDetails) {
                return res.status(404).json({ message: 'Associated product not found for this work order.' });
            }

            // Determine the final packing status for the finished product
            const packingType = await PackingType.findById(productDetails.packingType);
            const finalPackingStatus = packingType ? packingType.name : 'In Stock'; // Default if packingType is not found

            // If it's a bulk product and packing is done, or if it's a blanket and all steps are complete
            if (productDetails.productType === 'bulk' || newStatus === 'Complete') {
                 // Add finished product to Inventory
                let inventoryItem = await Inventory.findOne({
                    item: workOrder.product,
                    itemType: 'Product',
                    status: finalPackingStatus // Use the determined packing status
                });

                if (inventoryItem) {
                    inventoryItem.quantity += completedQuantity || workOrder.quantityToProduce;
                    await inventoryItem.save();
                } else {
                    // Create new inventory entry if it doesn't exist
                    inventoryItem = new Inventory({
                        item: workOrder.product,
                        itemType: 'Product',
                        quantity: completedQuantity || workOrder.quantityToProduce,
                        unit: workOrder.unit,
                        status: finalPackingStatus,
                        location: 'Finished Goods Warehouse' // Or a more specific location
                    });
                    await inventoryItem.save();
                }
            }

            // Mark the overall work order as complete
            workOrder.currentStatus = 'Complete';
        } else {
            // Update the overall current status if it's not 'Complete'
            workOrder.currentStatus = newStatus;
        }

        await workOrder.save();
        res.status(200).json({ message: 'Work order updated successfully.', workOrder });

    } catch (error) {
        console.error('Error updating work order:', error);
        res.status(500).json({ message: 'Server error while updating work order.', error: error.message });
    }
};

// --- Controller to Handle Re-packing ---
export const rePackProduct = async (req, res) => {
    try {
        const { productId, quantity, originalPackingStatus, newPackingStatusName, repackingCost, customerOrder, repackedBy } = req.body;

        // Basic validation for required fields
        if (!productId || !quantity || !originalPackingStatus || !newPackingStatusName) {
            return res.status(400).json({ message: 'Missing required fields for re-packing.' });
        }

        // 1. Find the product to ensure it exists and get its unit
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        // 2. Find the new packing type to get its ObjectId
        const newPackingType = await PackingType.findOne({ name: newPackingStatusName });
        if (!newPackingType) {
            return res.status(404).json({ message: `New packing type '${newPackingStatusName}' not found.` });
        }
        const newPackingTypeId = newPackingType._id;


        // 3. Check if enough product is available in the original packing status
        const originalInventory = await Inventory.findOne({
            item: productId,
            itemType: 'Product',
            status: originalPackingStatus
        });

        if (!originalInventory || originalInventory.quantity < quantity) {
            return res.status(400).json({
                message: `Insufficient stock in '${originalPackingStatus}'. Available: ${originalInventory ? originalInventory.quantity : 0} ${product.product_unit}, Needed: ${quantity} ${product.product_unit}.`
            });
        }

        // 4. Deduct quantity from original packing status
        originalInventory.quantity -= quantity;
        await originalInventory.save();

        // 5. Add quantity to new packing status
        let newInventory = await Inventory.findOne({
            item: productId,
            itemType: 'Product',
            status: newPackingStatusName // Use the name for status field
        });

        if (newInventory) {
            newInventory.quantity += quantity;
            await newInventory.save();
        } else {
            // Create new inventory entry if it doesn't exist for this packing status
            newInventory = new Inventory({
                item: productId,
                itemType: 'Product',
                quantity: quantity,
                unit: product.product_unit, // Use the unit from the product
                status: newPackingStatusName,
                location: 'Finished Goods Warehouse' // Default location
            });
            await newInventory.save();
        }

        // 6. Create a RePackingLog entry
        const rePackingLog = new RePackingLog({
            product: productId,
            quantity: quantity,
            unit: product.product_unit,
            originalPackingStatus: originalPackingStatus,
            newPackingStatus: newPackingStatusName, // Store the name for the log
            repackingCost: repackingCost || 0,
            customerOrder: customerOrder,
            repackedBy: repackedBy,
            repackedAt: new Date()
        });

        await rePackingLog.save();

        res.status(200).json({ message: 'Product re-packed successfully.', rePackingLog });

    } catch (error) {
        console.error('Error re-packing product:', error);
        res.status(500).json({ message: 'Server error during re-packing operation.', error: error.message });
    }
};

// --- Controller to Fetch All Re-packing Logs ---
export const getAllRePackingLogs = async (req, res) => {
    try {
        // Find all re-packing logs and populate the 'product' field
        // This will replace the product ObjectId with the actual product document
        const rePackingLogs = await RePackingLog.find().populate('product');
        res.status(200).json(rePackingLogs);
    } catch (error) {
        console.error('Error fetching re-packing logs:', error);
        res.status(500).json({ message: 'Server error while fetching re-packing logs.', error: error.message });
    }
};

// --- Controller to Fetch All Inventory Items ---
export const getAllInventory = async (req, res) => {
    try {
        // Find all inventory items and populate the 'item' field based on 'itemType'
        // This will replace the item ObjectId with the actual Product or RawMaterial document
        const inventoryItems = await Inventory.find()
            .populate('item'); // Mongoose will automatically use refPath 'itemType'

        res.status(200).json(inventoryItems);
    } catch (error) {
        console.error('Error fetching inventory items:', error);
        res.status(500).json({ message: 'Server error while fetching inventory items.', error: error.message });
    }
};