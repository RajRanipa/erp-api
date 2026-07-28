import mongoose from "mongoose";
import GatewayIngestBatch from "../models/GatewayIngestBatch.js";
import ProductionBlanketRoll from "../models/ProductionBlanketRoll.js";
import Item from "../models/Item.js";
import Campaign from "../models/Campaign.js";
import { receive as invReceive } from "../services/inventoryService.js";
import Temperature from "../models/Temperature.js";
import Density from "../models/Density.js";
import Dimension from "../models/Dimension.js";
import ProductType from "../models/ProductType.js";
import Warehouse from "../models/Warehouse.js";
import { AppError } from "../utils/errorHandler.js";

/**
 * Your sizeCode mapping (provided)
 */
const SIZE_CODE_MAP = {
    1: { length: 7300, width: 610, thickness: 25 },
    2: { length: 3650, width: 610, thickness: 50 },
    3: { length: 7320, width: 610, thickness: 25 },
    4: { length: 7620, width: 610, thickness: 25 },
    5: { length: 7300, width: 610, thickness: 12 },
    8: { length: 8000, width: 600, thickness: 30 },
};

const CATEGORY_KEY_BY_NAME = Object.freeze({
    "raw material": "RAW",
    "finished goods": "FG",
    "packing material": "PACKING",
    "non-conformance": "NC",
});

export function categoryKeyFromName(name) {
    return CATEGORY_KEY_BY_NAME[String(name || "").trim().toLowerCase()] || null;
}

/**
 * Gateway processing uses the first category configured on ProductType.
 * Accepted output cannot enter NC, and rejected output cannot enter FG.
 */
export function inventoryCategoryForStatus(category = null, statusOk = false) {
    const normalized = {
        id: category?.id || category?._id || null,
        name: String(category?.name || "").trim().toLowerCase(),
        key: category?.key || categoryKeyFromName(category?.name),
    };

    if (!normalized.id || !normalized.key) return null;
    if (statusOk && normalized.key === "NC") return null;
    if (!statusOk && normalized.key === "FG") return null;
    return normalized;
}

export function shouldPostGatewayInventory({
    productCode,
    statusOk,
    weightKg,
    targetCategory = null,
}) {
    if (!Number.isFinite(Number(weightKg)) || Number(weightKg) <= 0) return false;
    if (statusOk || Number(productCode) === 5) return true;
    return Boolean(targetCategory?.key && targetCategory.key !== "FG");
}

function normalizeStatus(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") {
        return ["true", "1", "ok", "pass", "yes"].includes(
            v.trim().toLowerCase()
        );
    }
    return false;
}

function safeDate(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

const escapeRegex = value =>
    String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function resolveWarehouseId(companyId) {
    // Prefer an explicit fixed warehouse for gateway receipts
    const fixedId = process.env.GATEWAY_WAREHOUSE_ID;
    if (fixedId) {
        const warehouse = await Warehouse.findOne({
            _id: fixedId,
            companyId,
            status: "active",
        }).select('_id').lean();
        return warehouse?._id || null;
    }

    const fixedCode = process.env.GATEWAY_WAREHOUSE_CODE;
    if (fixedCode) {
        const wh = await Warehouse.findOne({
            companyId,
            status: "active",
            code: { $regex: new RegExp(`^${escapeRegex(fixedCode)}$`, "i") },
        }).lean();
        return wh?._id || null;
    }

    const fixedName = process.env.GATEWAY_WAREHOUSE_NAME;
    if (fixedName) {
        const wh = await Warehouse.findOne({
            companyId,
            status: "active",
            name: { $regex: new RegExp(`^${escapeRegex(fixedName)}$`, "i") },
        }).lean();
        return wh?._id || null;
    }

    // Fallback: pick the first/oldest warehouse
    const wh = await Warehouse.findOne({ companyId, status: "active" })
        .sort({ createdAt: 1 })
        .lean();
    return wh?._id || null;
}

async function resolvePackingItem(companyId) {
    // by name mapping (your request)
    const packing = await Item.findOne({
        companyId,
        categoryKey: "PACKING",
        status: "active",
        name: { $regex: /plastic\s*bag/i },
    }).select("_id name").lean();

    return packing?._id || null;
}

async function resolveDimension({ productTypeId, sizeCode }) {
    const spec = SIZE_CODE_MAP[sizeCode];

    if (!spec) {
        return {
            id: null,
            err: `Invalid sizeCode received from PLC: ${sizeCode}`,
        };
    }

    const dim = await Dimension.findOne({
        productType: productTypeId,
        length: spec.length,
        width: spec.width,
        thickness: spec.thickness,
        unit: "mm",
    }).lean();

    if (!dim) {
        return {
            id: null,
            err: `Dimension not found (${spec.length}x${spec.width}x${spec.thickness} mm) for productType`,
        };
    }

    return { id: dim._id, err: null };
}

async function resolveProductType(productCode) {
    // Map PLC product codes to ProductType.name (lowercase)
    const PRODUCT_CODE_MAP = {
        1: "blanket",
        2: "bulk",
        3: "board",
        4: "module",
        5: "et",
    };

    const name = PRODUCT_CODE_MAP[productCode];
    if (!name) {
        return {
            id: null,
            name: null,
            category: null,
            err: `Unsupported productCode: ${productCode}`,
        };
    }

    const pt = await ProductType?.findOne({ name }).populate("categories", "name").lean();

    if (!pt) {
        return {
            id: null,
            name,
            category: null,
            err: `ProductType '${name}' not found in DB`,
        };
    }

    const firstCategory = pt.categories?.[0] || null;
    const category = firstCategory
        ? {
            id: firstCategory._id || null,
            name: String(firstCategory.name || "").trim().toLowerCase(),
            key: categoryKeyFromName(firstCategory.name),
        }
        : null;

    if (!category?.id || !category.key) {
        return {
            id: null,
            name,
            category: null,
            err: `ProductType '${name}' has no supported first Item category`,
        };
    }
    return { id: pt._id, name, category, err: null };
}

// async function resolveTempDensity(companyId, temperatureValue, densityValue) {
//     const errs = [];
//     const temp = await Temperature?.findOne({ companyId, value: temperatureValue }).lean();
//     if (!temp) errs.push(`Temperature not found for value ${temperatureValue}`);

//     const dens = await Density?.findOne({ companyId, value: densityValue }).lean();
//     if (!dens) errs.push(`Density not found for value ${densityValue}`);

//     return { tempId: temp?._id || null, densId: dens?._id || null, errs };
// }

async function resolveDensity({ productTypeId, densityValue }) {
    const errs = [];

    if (!productTypeId) {
        return {
            densId: null,
            errs: ["productTypeId is required to resolve temperature/density"],
        };
    }

    // const tVal = Number(temperatureValue);
    const dVal = Number(densityValue);

    const dens = await Density?.findOne({ productType: productTypeId, value: dVal }).lean();
    if (!dens) errs.push(`Density not found for productType ${productTypeId} value ${dVal}`);

    return { densId: dens?._id || null, errs };
}
async function resolveTemp({ productTypeId, temperatureValue }) {
    const errs = [];

    if (!productTypeId) {
        return {
            tempId: null,
            errs: ["productTypeId is required to resolve temperature/density"],
        };
    }

    const tVal = Number(temperatureValue);

    const temp = await Temperature?.findOne({ productType: productTypeId, value: tVal }).lean();
    if (!temp) errs.push(`Temperature not found for productType ${productTypeId} value ${tVal}`);

    return { tempId: temp?._id || null, errs };
}

async function matchGatewayItem(filter) {
    const matches = await Item.find(filter)
        .select("_id UOM name category categoryKey")
        .sort({ _id: 1 })
        .limit(2)
        .lean();
    if (matches.length > 1) {
        return {
            item: null,
            err: "Multiple active Items match the gateway specifications",
        };
    }
    return {
        item: matches[0] || null,
        err: matches.length ? null : "Matching active Item not found",
    };
}

export function inventoryQuantityForGatewayRecord(weightKg, itemUom) {
    const uom = String(itemUom || '').trim().toLowerCase();
    if (uom === 'kg') return weightKg;
    if (['g', 'gram', 'grams'].includes(uom)) return weightKg * 1000;
    if (['ton', 'tonne', 't'].includes(uom)) return weightKg / 1000;
    if (['roll', 'rolls', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'].includes(uom)) {
        return 1;
    }
    throw new AppError(
        `Gateway weight cannot be posted to Item UOM "${itemUom}"`,
        { statusCode: 409, code: "GATEWAY_UOM_MISMATCH" }
    );
}

async function resolveCampaign(companyId) {
    // Campaigns are currently global records and do not yet carry companyId.
    // Keep this lookup compatible until the manufacturing migration adds it.
    void companyId;
    const campaign = await Campaign.findOne({ status: "RUNNING" }).lean();
    return campaign?._id;
}

export async function ingestBlanketBatch({ companyId, payload }) {
    try {
        if (!companyId) {
            throw new AppError("companyId is required for gateway ingestion", { statusCode: 400, code: "MISSING_COMPANY" });
        }

        const {
            gatewayId,
            sentAt,
            records,
            clientBatchId = null,
            contractVersion = "1.0",
        } = payload || {};
        if (!gatewayId) {
            throw new AppError("gatewayId is required", { statusCode: 400, code: "MISSING_GATEWAY" });
        }
        if (!Array.isArray(records)) {
            throw new AppError("records must be an array", { statusCode: 400, code: "INVALID_PAYLOAD" });
        }
        if (records.length === 0 || records.length > 100) {
            throw new AppError("records must contain between 1 and 100 entries", {
                statusCode: 400,
                code: "INVALID_PAYLOAD",
            });
        }

        const campaign = await resolveCampaign(companyId);
        if (!campaign) {
            throw new AppError("Campaign not found", { statusCode: 400, code: "INVALID_SITUATION" });
        }

        const batch = await GatewayIngestBatch.create({
            campaign,
            companyId,
            gatewayId,
            clientBatchId,
            contractVersion,
            sentAt: safeDate(sentAt),
            recordsCount: records.length,
            rawPayload: payload,
            processingStatus: "RECEIVED",
        });

        const warehouseId = await resolveWarehouseId(companyId);
        const packingId = await resolvePackingItem(companyId);
        if (!warehouseId) console.warn("[gateway] No warehouse found (set GATEWAY_WAREHOUSE_ID/CODE/NAME)");
        if (!packingId) console.warn("[gateway] Packing item not found by name 'plastic bag' for companyId", companyId);

        const summary = {
            batchId: batch._id,
            received: records.length,
            inserted: 0,
            duplicates: 0,
            postedToInventory: 0,
            inventorySkipped: 0,
            inventoryPending: 0,
            failed: 0,
            errors: [],
            warnings: [],
            recordResults: [],
        };

        const campaignSummary = {
            blanketRolls: 0,
            bulkKg: 0,
            fiberKg: 0,
            goodFiberKg: 0,
            rejectedFiberKg: 0,
        };

        // --- FLAT ARRAY LOOP STARTS HERE ---
        for (const rec of records) {
            const recordId = rec?.recordId;
            const recordResult = {
                recordId: recordId ? String(recordId) : null,
                scaleNo: Number(rec?.scaleNo) || null,
                accepted: false,
                retryable: true,
                storageStatus: "REJECTED",
                inventoryStatus: "NOT_ATTEMPTED",
                code: null,
                message: null,
            };
            summary.recordResults.push(recordResult);
            // console.log("Processing recordId", recordId);

            const productCode = Number(rec?.productCode);
            const temperatureValue = Number(rec?.temperature);
            const densityValue = Number(rec?.density);
            const sizeCode = Number(rec?.sizeCode);
            const batchNo = rec?.batchNo || "";
            const at = safeDate(rec?.at) || new Date();

            // EXTRACT SCALE DATA DIRECTLY FROM THE FLAT RECORD
            const scaleNo = Number(rec?.scaleNo);
            const weightKg = Number(rec?.weight || 0);
            const statusOk = normalizeStatus(rec?.status);

            if (!recordId || String(recordId).length > 120) {
                summary.failed++;
                recordResult.code = "INVALID_RECORD_ID";
                recordResult.message = "recordId is required and must not exceed 120 characters";
                summary.errors.push(
                    `scale ${scaleNo || "unknown"}: ${recordResult.message}`
                );
                continue;
            }
            if (![1, 2, 3].includes(scaleNo)) {
                summary.failed++;
                recordResult.code = "INVALID_SCALE";
                recordResult.message = `Unsupported scaleNo: ${rec?.scaleNo}`;
                summary.errors.push(
                    `recordId ${recordId}: ${recordResult.message}`
                );
                continue;
            }
            if (![1, 2, 3, 4, 5].includes(productCode)) {
                summary.failed++;
                recordResult.code = "INVALID_PRODUCT_CODE";
                recordResult.message = `Unsupported productCode: ${rec?.productCode}`;
                summary.errors.push(
                    `recordId ${recordId}: ${recordResult.message}`
                );
                continue;
            }
            if (!Number.isFinite(weightKg) || weightKg <= 0) {
                summary.failed++;
                recordResult.code = "INVALID_WEIGHT";
                recordResult.message = `weight must be greater than zero; received ${rec?.weight}`;
                summary.errors.push(
                    `recordId ${recordId}: ${recordResult.message}`
                );
                continue;
            }

            // resolve shared refs
            const resolveErrors = [];
            const resolvedProductType = await resolveProductType(productCode);
            const productTypeId = resolvedProductType?.id;
            if (resolvedProductType.err) resolveErrors.push(resolvedProductType.err);
            const targetCategory = inventoryCategoryForStatus(
                resolvedProductType.category,
                statusOk,
            );

            let dimensionId = null;
            let temperatureId = null;
            let densityId = null;
            let matchedItemId = null;
            let matchedItemUom = "roll";
            let matchedItemCategoryId = null;
            let matchedItemCategoryKey = null;

            if (productTypeId) {
                if (productCode !== 5) {
                    const dimRes = await resolveDimension({ productTypeId, sizeCode });
                    dimensionId = dimRes.id;
                    if (dimRes.err) resolveErrors.push(dimRes.err);
                    // console.log('dimRes -> ', dimRes);
                }
                if (productTypeId) {
                    const temp = await resolveTemp({ productTypeId, temperatureValue });
                    temperatureId = temp.tempId;
                    if (temp.errs?.length) resolveErrors.push(...temp.errs);
                    // console.log('temp -> ', temp);
                }
                if (![3, 5].includes(productCode)) {
                    const dens = await resolveDensity({ productTypeId, densityValue });
                    densityId = dens.densId;
                    if (dens.errs?.length) resolveErrors.push(...dens.errs);
                }

                const requiredSpecificationsResolved = Boolean(
                    temperatureId
                    && (
                        productCode === 5
                        || (
                            dimensionId
                            && packingId
                            && (productCode === 3 || densityId)
                        )
                    )
                );
                if (productCode !== 5 && !packingId) {
                    resolveErrors.push("Active packing Item 'plastic bag' was not found");
                }

                if (targetCategory && requiredSpecificationsResolved) {
                    const itemFilter = {
                        companyId,
                        category: targetCategory.id,
                        categoryKey: targetCategory.key,
                        productType: productTypeId,
                        temperature: temperatureId,
                        status: "active",
                    };
                    if (productCode !== 5) {
                        itemFilter.packing = packingId;
                        itemFilter.dimension = dimensionId;
                    }
                    if (![3, 5].includes(productCode)) {
                        itemFilter.density = densityId;
                    }

                    const match = await matchGatewayItem(itemFilter);
                    if (match.item) {
                        matchedItemId = match.item._id;
                        matchedItemUom = match.item.UOM || "roll";
                        matchedItemCategoryId = match.item.category;
                        matchedItemCategoryKey = match.item.categoryKey;
                    } else {
                        resolveErrors.push(
                            `${match.err}: category=${targetCategory.key}:${targetCategory.name} `
                            + `productType=${resolvedProductType.name} `
                            + `temperature=${temperatureValue} density=${densityValue} `
                            + `sizeCode=${sizeCode} packing=${packingId || "none"}`
                        );
                    }
                } else if (!targetCategory && (statusOk || productCode === 5)) {
                    resolveErrors.push(
                        `ProductType '${resolvedProductType.name}' has no first category `
                        + `eligible for ${statusOk ? "accepted" : "rejected"} inventory`
                    );
                }
            } else {
                resolveErrors.push("productTypeId not resolved; skipping dimension/temperature/density/matchedItem resolution");
            }

            let doc = null;
            try {
                let isNewRecord = false;
                try {
                    doc = await ProductionBlanketRoll.create({
                        companyId,
                        campaign,
                        gatewayId,
                        recordId,
                        at,
                        productCode,
                        temperatureValue,
                        densityValue,
                        sizeCode,
                        batchNo,
                        scaleNo,
                        weightKg,
                        statusOk,
                        productType: productTypeId,
                        temperature: temperatureId,
                        density: densityId,
                        dimension: dimensionId,
                        packingItem: productCode === 5 ? null : packingId,
                        matchedItem: matchedItemId,
                        itemCategory: matchedItemCategoryId,
                        itemCategoryKey: matchedItemCategoryKey,
                        resolveErrors,
                        ingestBatchId: batch._id,
                    });
                    isNewRecord = true;
                    summary.inserted++;
                    recordResult.accepted = true;
                    recordResult.retryable = false;
                    recordResult.storageStatus = "INSERTED";
                } catch (error) {
                    if (error?.code !== 11000) throw error;
                    doc = await ProductionBlanketRoll.findOne({
                        companyId,
                        gatewayId,
                        recordId,
                        scaleNo,
                    });
                    if (!doc) throw error;
                    summary.duplicates++;
                    recordResult.accepted = true;
                    recordResult.retryable = false;
                    recordResult.storageStatus = "DUPLICATE";
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id, inventoryPosted: false },
                        {
                            $set: {
                                productType: productTypeId,
                                temperature: temperatureId,
                                density: densityId,
                                dimension: dimensionId,
                                packingItem: productCode === 5 ? null : packingId,
                                matchedItem: matchedItemId,
                                itemCategory: matchedItemCategoryId,
                                itemCategoryKey: matchedItemCategoryKey,
                                resolveErrors,
                            },
                        }
                    );
                }

                if (isNewRecord) {
                    switch (productCode) {
                        case 1:
                            campaignSummary.blanketRolls++;
                            campaignSummary.fiberKg += weightKg;
                            if (!statusOk) campaignSummary.rejectedFiberKg += weightKg;
                            break;
                        case 2:
                            campaignSummary.fiberKg += weightKg;
                            if (statusOk) campaignSummary.bulkKg += weightKg;
                            else campaignSummary.rejectedFiberKg += weightKg;
                            break;
                        case 5:
                            campaignSummary.fiberKg += weightKg;
                            campaignSummary.rejectedFiberKg += weightKg;
                            break;
                    }
                }

                // Inventory posting (1-to-1 Traceability)
                const shouldPost = shouldPostGatewayInventory({
                    productCode,
                    statusOk,
                    weightKg,
                    targetCategory,
                });

                if (doc.inventoryPosted) {
                    recordResult.inventoryStatus = "ALREADY_POSTED";
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                inventoryStatus: "POSTED",
                                inventoryLastError: null,
                            },
                        }
                    );
                    continue;
                }

                if (!shouldPost) {
                    summary.inventorySkipped++;
                    recordResult.inventoryStatus = "NOT_APPLICABLE";
                    recordResult.code = "NO_INVENTORY_CATEGORY";
                    recordResult.message =
                        "Production is recorded, but its ProductType category is not eligible for this quality status";
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                inventoryStatus: "NOT_APPLICABLE",
                                inventoryLastError: null,
                            },
                        }
                    );
                    continue;
                }

                if (!warehouseId) {
                    const message = "Warehouse not found to post inventory";
                    summary.inventoryPending++;
                    summary.warnings.push(`recordId ${recordId} scale ${scaleNo}: ${message}`);
                    recordResult.inventoryStatus = "PENDING";
                    recordResult.code = "WAREHOUSE_NOT_FOUND";
                    recordResult.message = message;
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                inventoryStatus: "PENDING",
                                inventoryLastError: message,
                                inventoryLastAttemptAt: new Date(),
                            },
                            $addToSet: { resolveErrors: message },
                        }
                    );
                    continue;
                }

                if (!matchedItemId) {
                    const message = resolveErrors.join("; ") || "Matching Item not found";
                    summary.inventoryPending++;
                    summary.warnings.push(`recordId ${recordId} scale ${scaleNo}: ${message}`);
                    recordResult.inventoryStatus = "PENDING";
                    recordResult.code = "ITEM_NOT_MATCHED";
                    recordResult.message = message;
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                inventoryStatus: "PENDING",
                                inventoryLastError: message,
                                inventoryLastAttemptAt: new Date(),
                            },
                        }
                    );
                    continue;
                }

                const inventoryQuantity = inventoryQuantityForGatewayRecord(
                    weightKg,
                    matchedItemUom
                );
                const gatewayMovementKey = (
                    `PROD_GATEWAY:${companyId}:${gatewayId}:${recordId}:${scaleNo}`
                );
                const invRes = await invReceive({
                    companyId,
                    itemId: matchedItemId,
                    warehouseId,
                    uom: matchedItemUom,
                    qty: inventoryQuantity,
                    by: null,
                    note: `Auto receipt from gateway ${gatewayId} recordId ${recordId} scale ${scaleNo}`,
                    refType: "PROD_GATEWAY",
                    refId: doc._id,
                    idempotencyKey: gatewayMovementKey,
                    enforceNonNegative: false,
                    batchNo: batchNo || null,
                    at,
                });

                const inventoryLinkResult = await ProductionBlanketRoll.updateOne(
                    { _id: doc._id, inventoryPosted: false },
                    {
                        $set: {
                            inventoryPosted: true,
                            inventoryStatus: "POSTED",
                            inventoryLastError: null,
                            inventoryLastAttemptAt: new Date(),
                            inventoryRef: {
                                ledgerId: invRes?.ledger?._id,
                                snapshotId: invRes?.snapshot?._id,
                            },
                        },
                    }
                );

                // Only the process that changes false → true owns the counters.
                if (inventoryLinkResult.modifiedCount > 0) {
                    summary.postedToInventory++;
                    if (statusOk) campaignSummary.goodFiberKg += weightKg;
                }
                recordResult.inventoryStatus = "POSTED";
            } catch (err) {
                if (doc) {
                    const message = `Inventory posting failed: ${err.message}`;
                    recordResult.accepted = true;
                    recordResult.retryable = false;
                    recordResult.inventoryStatus = "FAILED";
                    recordResult.code = err.code || "INVENTORY_POST_FAILED";
                    recordResult.message = message;
                    summary.inventoryPending++;
                    summary.warnings.push(
                        `recordId ${recordId} scale ${scaleNo}: ${message}`
                    );
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        {
                            $set: {
                                inventoryStatus: "FAILED",
                                inventoryLastError: message,
                                inventoryLastAttemptAt: new Date(),
                            },
                            $addToSet: { resolveErrors: message },
                        }
                    ).catch(() => {});
                } else {
                    summary.failed++;
                    recordResult.code = err.code || "RECORD_STORE_FAILED";
                    recordResult.message = err.message;
                    summary.errors.push(`recordId ${recordId} scale ${scaleNo}: ${err.message}`);
                }
            }
        }

        // finalize batch status
        const acceptedCount = summary.recordResults.filter(
            result => result.accepted
        ).length;
        const status = acceptedCount === 0
            ? "FAILED"
            : summary.failed > 0 || summary.inventoryPending > 0
                ? "PARTIAL"
                : "PROCESSED";

        await GatewayIngestBatch.updateOne(
            { _id: batch._id },
            { $set: { processingStatus: status, processingSummary: summary } }
        );

        if (
            campaignSummary.blanketRolls ||
            campaignSummary.bulkKg ||
            campaignSummary.fiberKg ||
            campaignSummary.goodFiberKg ||
            campaignSummary.rejectedFiberKg
        ) {
            const result = await Campaign.updateOne(
                { _id: campaign },
                {
                    $inc: {
                        totalBlanketRollsProduced: campaignSummary.blanketRolls,
                        totalBulkKgProduced: campaignSummary.bulkKg,
                        totalFiberProduced: campaignSummary.fiberKg,
                        totalGoodFiberProduced: campaignSummary.goodFiberKg,
                        totalRejectedFiber: campaignSummary.rejectedFiberKg,
                    },
                }
            );
            if (result.matchedCount === 0) {
                throw new Error("Running campaign disappeared while processing batch.");
            }
        }
        const result = {
            ok: true,
            gatewayId: payload.gatewayId,
            batchId: batch._id,
            status,
            summary,
            recordResults: summary.recordResults,
        };

        console.log('Batch Result : ', result.status, result.summary);
        return result; // <--- FIXED: Now returns the payload to the controller

    } catch (error) {
        error.context = {
            service: "gatewayProductionService.ingestBlanketBatch",
            at: new Date().toISOString(),
        };
        throw error;
    }
}

export async function reconcilePendingGatewayInventory({ limit = 100 } = {}) {
    const documents = await ProductionBlanketRoll.find({
        inventoryPosted: false,
        $or: [
            { inventoryStatus: { $in: ["PENDING", "FAILED"] } },
            { inventoryStatus: { $exists: false } },
            { productCode: 5, inventoryStatus: "NOT_APPLICABLE" },
        ],
    })
        .sort({ at: 1, _id: 1 })
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
        .lean();

    const summary = {
        scanned: documents.length,
        posted: 0,
        notApplicable: 0,
        stillPending: 0,
        failed: 0,
    };
    const companyContext = new Map();

    for (const document of documents) {
        const resolvedType = await resolveProductType(document.productCode);
        const targetCategory = inventoryCategoryForStatus(
            resolvedType.category,
            document.statusOk,
        );
        const shouldPost = shouldPostGatewayInventory({
            productCode: document.productCode,
            statusOk: document.statusOk,
            weightKg: document.weightKg,
            targetCategory,
        });
        if (!shouldPost) {
            await ProductionBlanketRoll.updateOne(
                { _id: document._id, inventoryPosted: false },
                {
                    $set: {
                        inventoryStatus: "NOT_APPLICABLE",
                        inventoryLastError: null,
                    },
                }
            );
            summary.notApplicable++;
            continue;
        }

        const companyKey = String(document.companyId);
        let context = companyContext.get(companyKey);
        if (!context) {
            context = {
                warehouseId: await resolveWarehouseId(document.companyId),
                packingId: await resolvePackingItem(document.companyId),
            };
            companyContext.set(companyKey, context);
        }

        try {
            if (!context.warehouseId) {
                throw new AppError("Warehouse not found to post inventory", {
                    statusCode: 409,
                    code: "WAREHOUSE_NOT_FOUND",
                });
            }

            let matchedItem = document.matchedItem && targetCategory
                ? await Item.findOne({
                    _id: document.matchedItem,
                    companyId: document.companyId,
                    status: "active",
                    category: targetCategory.id,
                    categoryKey: targetCategory.key,
                }).select("_id UOM category categoryKey").lean()
                : null;

            if (!matchedItem) {
                if (!resolvedType.id) {
                    throw new AppError(resolvedType.err, {
                        statusCode: 409,
                        code: "PRODUCT_TYPE_NOT_RESOLVED",
                    });
                }
                if (!targetCategory) {
                    throw new AppError(
                        `ProductType '${resolvedType.name}' has no first category eligible for this quality status`,
                        {
                            statusCode: 409,
                            code: "INVENTORY_CATEGORY_NOT_RESOLVED",
                        },
                    );
                }
                const itemFilter = {
                    companyId: document.companyId,
                    category: targetCategory.id,
                    categoryKey: targetCategory.key,
                    productType: resolvedType.id,
                    temperature: document.temperature,
                    status: "active",
                };
                if (document.productCode !== 5) {
                    itemFilter.packing = context.packingId;
                    itemFilter.dimension = document.dimension;
                }
                if (![3, 5].includes(document.productCode)) {
                    itemFilter.density = document.density;
                }
                const match = await matchGatewayItem(itemFilter);
                matchedItem = match.item;
                if (!matchedItem && match.err) {
                    throw new AppError(match.err, {
                        statusCode: 409,
                        code: "ITEM_NOT_MATCHED",
                    });
                }
            }

            if (!matchedItem) {
                throw new AppError("Matching Item not found for gateway specifications", {
                    statusCode: 409,
                    code: "ITEM_NOT_MATCHED",
                });
            }

            const quantity = inventoryQuantityForGatewayRecord(
                document.weightKg,
                matchedItem.UOM || "roll"
            );
            const result = await invReceive({
                companyId: document.companyId,
                itemId: matchedItem._id,
                warehouseId: context.warehouseId,
                uom: matchedItem.UOM || "roll",
                qty: quantity,
                by: null,
                note: `Reconciled gateway ${document.gatewayId} recordId ${document.recordId} scale ${document.scaleNo}`,
                refType: "PROD_GATEWAY",
                refId: document._id,
                idempotencyKey: `PROD_GATEWAY:${document.companyId}:${document.gatewayId}:${document.recordId}:${document.scaleNo}`,
                enforceNonNegative: false,
                batchNo: document.batchNo || null,
                at: document.at,
            });
            const linked = await ProductionBlanketRoll.updateOne(
                { _id: document._id, inventoryPosted: false },
                {
                    $set: {
                        matchedItem: matchedItem._id,
                        itemCategory: matchedItem.category,
                        itemCategoryKey: matchedItem.categoryKey,
                        inventoryPosted: true,
                        inventoryStatus: "POSTED",
                        inventoryLastError: null,
                        inventoryLastAttemptAt: new Date(),
                        inventoryRef: {
                            ledgerId: result?.ledger?._id,
                            snapshotId: result?.snapshot?._id,
                        },
                    },
                }
            );
            if (linked.modifiedCount > 0) {
                summary.posted++;
                if (document.statusOk) {
                    await Campaign.updateOne(
                        { _id: document.campaign },
                        { $inc: { totalGoodFiberProduced: document.weightKg } }
                    );
                }
            }
        } catch (error) {
            const message = String(error?.message || error).slice(0, 1000);
            await ProductionBlanketRoll.updateOne(
                { _id: document._id, inventoryPosted: false },
                {
                    $set: {
                        inventoryStatus: "PENDING",
                        inventoryLastError: message,
                        inventoryLastAttemptAt: new Date(),
                    },
                    $addToSet: { resolveErrors: message },
                }
            );
            if ([
                "WAREHOUSE_NOT_FOUND",
                "ITEM_NOT_MATCHED",
                "PRODUCT_TYPE_NOT_RESOLVED",
                "INVENTORY_CATEGORY_NOT_RESOLVED",
            ].includes(error?.code)) {
                summary.stillPending++;
            } else {
                summary.failed++;
            }
        }
    }

    return summary;
}
