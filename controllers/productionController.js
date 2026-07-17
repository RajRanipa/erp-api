// controllers/productionController.js
import RawMaterial from '../models/Rawmaterial.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import BOM from '../models/BOM.js';
import WorkOrder from '../models/WorkOrder.js'; // Import the new WorkOrder model
import Item from '../models/Item.js';
import mongoose from "mongoose";
import { DateTime } from 'luxon';

const REPORT_TIMEZONE = 'Asia/Kolkata';

const PRODUCTION_TIME_FIELD = 'at';

function parseReportDate(date = null) {
    const reportDate = date
        ? DateTime.fromISO(date, {
            zone: REPORT_TIMEZONE,
        })
        : DateTime.now().setZone(REPORT_TIMEZONE);

    if (!reportDate.isValid) {
        throw new Error(`Invalid report date: ${date}`);
    }

    return reportDate.startOf('day');
}

function getTodayDayShiftRange(date = null) {
    const reportDate = parseReportDate(date);

    const startIST = reportDate.set({
        hour: 8,
        minute: 0,
        second: 0,
        millisecond: 0,
    });

    const endIST = reportDate.set({
        hour: 20,
        minute: 0,
        second: 0,
        millisecond: 0,
    });

    return {
        start: startIST.toUTC().toJSDate(),
        end: endIST.toUTC().toJSDate(),

        startIST: startIST.toISO(),
        endIST: endIST.toISO(),
    };
}

function getTodayNightShiftRange(date = null) {
    const reportDate = parseReportDate(date);

    const startIST = reportDate.minus({ days: 1 })({
        hour: 20,
        minute: 0,
        second: 0,
        millisecond: 0,
    });

    const endIST = reportDate.set({
        hour: 8,
        minute: 0,
        second: 0,
        millisecond: 0,
    });

    return {
        start: startIST.toUTC().toJSDate(),
        end: endIST.toUTC().toJSDate(),

        startIST: startIST.toISO(),
        endIST: endIST.toISO(),
    };
}

export const getProductionDay = async (date = null) => {
    try {
        const {
            start,
            end,
            startIST,
            endIST,
        } = getTodayDayShiftRange(date);

        console.log('Production report range:', {
            startIST,
            endIST,
            startUTC: start.toISOString(),
            endUTC: end.toISOString(),
        });

        const data = await fetchproduction(start, end);

        return data;
    } catch (error) {
        throw new Error('Production day report error', {
            cause: error,
        });
    }
}

export const getProductionNight = async (date = null) => {
    try {

        const {
            start,
            end,
            startIST,
            endIST,
        } = getTodayNightShiftRange(date);

        console.log('Production report range:', {
            startIST,
            endIST,
            startUTC: start.toISOString(),
            endUTC: end.toISOString(),
        });

        const data = await fetchproduction(start, end);

        return data;
    } catch (error) {
        throw new Error('Production night report error:', error);
    }

}
export const fetchproduction = async (start, end, companyId) => {
    if (!(start instanceof Date)
        || Number.isNaN(start.getTime())
    ) {
        throw new Error('Valid start date is required');
    }

    if (!(end instanceof Date)
        || Number.isNaN(end.getTime())
    ) {
        throw new Error('Valid end date is required');
    }

    console.log("fetchproduction called with start:", start, "and end:", end);

    const data = await ProductionBlanketRoll.aggregate([
        // 1. FILTER
        {
            $match: {
                // companyId: new mongoose.Types.ObjectId(companyId),
                at: { $gte: start, $lt: end },
                matchedItem: { $ne: null }, // only valid items
            },
        },

        // 2. GROUP BY matchedItem and statusOk
        {
            $group: {
                _id: {
                    matchedItem: "$matchedItem",
                    statusOk: "$statusOk",
                },

                totalRolls: { $sum: 1 },
                totalWeight: {
                    $sum: {
                        $ifNull: ['$weightKg', 0],
                    },
                },

                // take first values (same for group)
                productType: { $first: "$productType" },
                temperature: { $first: "$temperature" },
                density: { $first: "$density" },
                dimension: { $first: "$dimension" },
                packingItem: { $first: "$packingItem" },
            },
        },

        //   3. LOOKUPS (populate)
        {
            $lookup: {
                from: "producttypes",
                localField: "productType",
                foreignField: "_id",
                as: "productType",
            },
        },
        { $unwind: { path: "$productType", preserveNullAndEmptyArrays: true } },

        {
            $lookup: {
                from: "temperatures",
                localField: "temperature",
                foreignField: "_id",
                as: "temperature",
            },
        },
        { $unwind: { path: "$temperature", preserveNullAndEmptyArrays: true } },

        {
            $lookup: {
                from: "densities",
                localField: "density",
                foreignField: "_id",
                as: "density",
            },
        },
        { $unwind: { path: "$density", preserveNullAndEmptyArrays: true } },

        {
            $lookup: {
                from: "dimensions",
                localField: "dimension",
                foreignField: "_id",
                as: "dimension",
            },
        },
        { $unwind: { path: "$dimension", preserveNullAndEmptyArrays: true } },

        {
            $lookup: {
                from: "items",
                localField: "packingItem",
                foreignField: "_id",
                as: "packingItem",
            },
        },
        { $unwind: { path: "$packingItem", preserveNullAndEmptyArrays: true } },

        // OPTIONAL: populate matchedItem also
        {
            $lookup: {
                from: "items",
                localField: "_id.matchedItem",
                foreignField: "_id",
                as: "matchedItem",
            },
        },
        { $unwind: { path: "$matchedItem", preserveNullAndEmptyArrays: true } },

        // 4. CLEAN OUTPUT
        {
            $project: {
                _id: 0,
                matchedItem: 1,
                productType: 1,
                temperature: 1,
                density: 1,
                dimension: 1,
                packingItem: 1,
                totalRolls: 1,
                totalWeight: 1,
                statusOk: "$_id.statusOk",
            },
        },

        // 5. SORT (optional)
        {
            $sort: { totalWeight: -1 },
        },
    ]);

    console.log("fetchproduction data ::::::: ", data);
    return data;
}

export const getAllProduction = async (req, res) => {
    try {
        const { companyId } = req.user; // or from params
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: "startDate and endDate required" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const data = await fetchproduction(start, end)

        return res.json({
            success: true,
            count: data.length,
            data,
        });

    } catch (error) {
        console.error("Production Summary Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getProductionReportDay = async (req, res) => {
    try {
        const { companyId } = req?.user; // or from params
        const { date } = req.query;
        // let date = null;
        const data = await getProductionDay(date);

        return res.json({
            success: true,
            count: data.length,
            data,
        });

    } catch (error) {
        console.error("Production Summary Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
export const getProductionReportNight = async (req, res) => {
    try {
        const { companyId } = req?.user; // or from params
        const { date } = req.query;
        // let date = null;
        const data = await getProductionNight(date);

        return res.json({
            success: true,
            count: data.length,
            data,
        });

    } catch (error) {
        console.error("Production Summary Error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

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
            const productDetails = await Item.findById(workOrder.product);
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
        const product = await Item.findById(productId);
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
                message: `Insufficient stock in '${originalPackingStatus}'. Available: ${originalInventory ? originalInventory.quantity : 0} ${product.UOM}, Needed: ${quantity} ${product.UOM}.`
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
                unit: product.UOM, // Use the unit from the product
                status: newPackingStatusName,
                location: 'Finished Goods Warehouse' // Default location
            });
            await newInventory.save();
        }

        // 6. Create a RePackingLog entry
        const rePackingLog = new RePackingLog({
            product: productId,
            quantity: quantity,
            unit: product.UOM,
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

export const getAllProduction1 = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // 1. Initialize empty match filter
        let queryFilter = {};

        // 2. Construct the date query if either date is provided
        if (startDate || endDate) {
            queryFilter.createdAt = {};

            if (startDate) {
                queryFilter.createdAt.$gte = new Date(startDate);
            }

            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                queryFilter.createdAt.$lte = end;
            }
        }

        // 3. Build the Aggregation Pipeline
        const pipeline = [];

        // Stage A: Filter records by date (Equivalent to your previous find query filter)
        if (Object.keys(queryFilter).length > 0) {
            pipeline.push({ $match: queryFilter });
        }

        // Stage B: Group by matchedItem, calculate count and sum of weightKg
        pipeline.push({
            $group: {
                _id: "$matchedItem",               // Group by the matchedItem ObjectId
                totalRecords: { $sum: 1 },         // Add 1 for every record found
                totalWeight: { $sum: "$weightKg" } // Sum the weightKg field
            }
        });

        // Stage C: (Optional but recommended) Populate the matchedItem details
        // Note: 'items' should be the actual lowercase, pluralized name of your Item collection in the DB.
        pipeline.push({
            $lookup: {
                from: "items",             // Collection name for the Item model
                localField: "_id",         // The _id from our $group stage (which is the matchedItem ObjectId)
                foreignField: "_id",       // The _id in the items collection
                as: "itemDetails"          // Put the result in this new array field
            }
        });

        // Stage D: Flatten the itemDetails array into an object
        pipeline.push({
            $unwind: {
                path: "$itemDetails",
                preserveNullAndEmptyArrays: true // Keep groups even if itemDetails isn't found
            }
        });

        // Stage E: Format the final output to look clean and professional
        pipeline.push({
            $project: {
                _id: 0,                         // Hide the default _id field
                matchedItemId: "$_id",          // Rename _id to matchedItemId
                itemName: "$itemDetails.name",  // Assuming your Item model has a 'name' field
                temperature: "$itemDetails.temperature",  // Assuming your Item model has a 'name' field
                density: "$itemDetails.density",  // Assuming your Item model has a 'name' field
                dimension: "$itemDetails.dimension",  // Assuming your Item model has a 'name' field
                packing: "$itemDetails.packing",  // Assuming your Item model has a 'name' field
                totalRecords: 1,                // Keep the totalRecords count
                totalWeight: 1                  // Keep the totalWeight sum
            }
        });

        // 4. Execute the pipeline
        const aggregatedProduction = await ProductionBlanketRoll.aggregate(pipeline).populate('dimension', 'width length thickness unit');

        res.status(200).json(aggregatedProduction);
    } catch (error) {
        console.error('Error fetching aggregated production data:', error);
        res.status(500).json({
            message: 'Server error while fetching production data.',
            error: error.message
        });
    }
};

