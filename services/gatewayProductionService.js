import mongoose from "mongoose";
import GatewayIngestBatch from "../models/GatewayIngestBatch.js";
import ProductionBlanketRoll from "../models/ProductionBlanketRoll.js";
import Item from "../models/Item.js";
import { receive as invReceive } from "../services/inventoryService.js";

// You will already have these models in your project:
const Temperature = mongoose.models.Temperature;
const Density = mongoose.models.Density;
const Dimension = mongoose.models.Dimension;
const ProductType = mongoose.models.ProductType;
const Warehouse = mongoose.models.Warehouse;

/**
 * Your sizeCode mapping (provided)
 */
const SIZE_CODE_MAP = {
    1: { l: 7300, w: 610, t: 25 },
    2: { l: 3650, w: 610, t: 50 },
    3: { l: 7320, w: 610, t: 25 },
    4: { l: 7620, w: 610, t: 25 },
    5: { l: 7300, w: 610, t: 12 },
};

function normalizeStatus(v) {
    // supports true/false and 0/1
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") return v === "true" || v === "1";
    return false;
}

function safeDate(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

async function resolveWarehouseId(companyId) {
    // If you later provide fixed warehouseId, replace this logic.
    const wh = await Warehouse?.findOne({ companyId }).sort({ createdAt: 1 }).lean();
    return wh?._id || null;
}

async function resolvePackingItem(companyId) {
    // by name mapping (your request)
    const packing = await Item.findOne({
        companyId,
        categoryKey: "PACKING",
        name: { $regex: /^plastic bag$/i },
    }).select("_id name").lean();

    return packing?._id || null;
}

async function resolveDimension({ companyId, productTypeId, sizeCode }) {
    const spec = SIZE_CODE_MAP[sizeCode];
    console.log('spec', spec);
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

async function resolveProductType(companyId, productCode) {
    // You said blanket only and code=1 for now.
    if (productCode !== 1) return { id: null, err: `Unsupported productCode: ${productCode}` };

    // If you have ProductType key/name like "blanket"
    const pt = await ProductType?.findOne({
        companyId,
        $or: [
            { key: { $regex: /^blanket$/i } },
            { name: { $regex: /^blanket$/i } },
        ],
    }).lean();

    if (!pt) return { id: null, err: `ProductType 'blanket' not found in DB` };
    return { id: pt._id, err: null };
}

async function resolveTempDensity(companyId, temperatureValue, densityValue) {
    const errs = [];
    const temp = await Temperature?.findOne({ companyId, value: temperatureValue }).lean();
    if (!temp) errs.push(`Temperature not found for value ${temperatureValue}`);

    const dens = await Density?.findOne({ companyId, value: densityValue }).lean();
    if (!dens) errs.push(`Density not found for value ${densityValue}`);

    return { tempId: temp?._id || null, densId: dens?._id || null, errs };
}

async function matchFGItem({ companyId, productTypeId, temperatureId, densityId, dimensionId, packingId }) {
    // Try strict match first (including packing)
    let item = await Item.findOne({
        companyId,
        categoryKey: "FG",
        productType: productTypeId,
        temperature: temperatureId,
        density: densityId,
        dimension: dimensionId,
        packing: packingId,
        status: "active",
    }).select("_id uom name").lean();

    // fallback: allow packing mismatch (in case FG items were created without packing)
    if (!item) {
        item = await Item.findOne({
            companyId,
            categoryKey: "FG",
            productType: productTypeId,
            temperature: temperatureId,
            density: densityId,
            dimension: dimensionId,
            status: "active",
        }).select("_id uom name").lean();
    }

    return item;
}

export async function ingestBlanketBatch({ companyId, payload }) {
    if (!companyId) throw new Error("companyId is required for gateway ingestion");
    const { gatewayId, sentAt, records } = payload || {};
    if (!gatewayId) throw new Error("gatewayId is required");
    if (!Array.isArray(records)) throw new Error("records must be an array");

    const batch = await GatewayIngestBatch.create({
        companyId,
        gatewayId,
        sentAt: safeDate(sentAt),
        recordsCount: records.length,
        rawPayload: payload,
        processingStatus: "RECEIVED",
    });

    const warehouseId = await resolveWarehouseId(companyId);
    const packingId = await resolvePackingItem(companyId);

    const summary = {
        batchId: batch._id,
        inserted: 0,
        duplicates: 0,
        postedToInventory: 0,
        failed: 0,
        errors: [],
    };

    for (const rec of records) {
        const recordId = rec?.recordId;
        const productCode = Number(rec?.productCode);
        const temperatureValue = Number(rec?.temperature);
        const densityValue = Number(rec?.density);
        const sizeCode = Number(rec?.sizeCode);
        const batchNo = rec?.batchNo || "";
        const at = safeDate(rec?.at) || new Date();

        const items = Array.isArray(rec?.items) ? rec.items : [];

        // resolve shared refs once per record
        const resolveErrors = [];

        const { id: productTypeId, err: ptErr } = await resolveProductType(companyId, productCode);
        if (ptErr) resolveErrors.push(ptErr);

        const { id: dimensionId, err: dimErr } = await resolveDimension(companyId, sizeCode);
        if (dimErr) resolveErrors.push(dimErr);

        const { tempId: temperatureId, densId: densityId, errs: tdErrs } =
            await resolveTempDensity(companyId, temperatureValue, densityValue);
        resolveErrors.push(...tdErrs);

        for (const it of items) {
            const scaleNo = Number(it?.scaleNo);
            const weightKg = Number(it?.weight || 0);
            const statusOk = normalizeStatus(it?.status);

            // ignore empty lines
            if (!scaleNo) continue;

            try {
                // insert normalized roll line (idempotent)
                const doc = await ProductionBlanketRoll.create({
                    companyId,
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
                    packingItem: packingId,

                    resolveErrors,
                    ingestBatchId: batch._id,
                });

                summary.inserted++;

                // Inventory posting
                const shouldPost = statusOk === true && weightKg > 0;

                if (!shouldPost) continue;
                if (!warehouseId) {
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        { $push: { resolveErrors: "Warehouse not found to post inventory" } }
                    );
                    continue;
                }

                // must match item
                const matchedItem = await matchFGItem({
                    companyId,
                    productTypeId,
                    temperatureId,
                    densityId,
                    dimensionId,
                    packingId,
                });

                if (!matchedItem) {
                    await ProductionBlanketRoll.updateOne(
                        { _id: doc._id },
                        { $push: { resolveErrors: "FG Item not found for resolved specs" } }
                    );
                    continue;
                }

                // post inventory as qty=1 roll
                const invRes = await invReceive({
                    companyId,
                    itemId: matchedItem._id,
                    warehouseId,
                    uom: matchedItem.uom || "roll",
                    qty: 1,
                    by: null, // gateway (no user). Later you can store a system userId.
                    note: `Auto receipt from gateway ${gatewayId} recordId ${recordId} scale ${scaleNo}`,
                    refType: "PROD_GATEWAY",
                    refId: doc._id,
                    enforceNonNegative: false,
                });

                await ProductionBlanketRoll.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            matchedItem: matchedItem._id,
                            inventoryPosted: true,
                            inventoryRef: {
                                ledgerId: invRes?.ledger?._id,
                                snapshotId: invRes?.snapshot?._id,
                            },
                        },
                    }
                );

                summary.postedToInventory++;
            } catch (err) {
                // Duplicate safe handling
                if (err?.code === 11000) {
                    summary.duplicates++;
                    continue;
                }
                summary.failed++;
                summary.errors.push(`recordId ${recordId} scale ${it?.scaleNo}: ${err.message}`);
            }
        }
    }

    // finalize batch status
    const status =
        summary.failed === 0 && summary.errors.length === 0
            ? "PROCESSED"
            : summary.postedToInventory > 0
                ? "PARTIAL"
                : "FAILED";

    await GatewayIngestBatch.updateOne(
        { _id: batch._id },
        { $set: { processingStatus: status, processingSummary: summary } }
    );

    return {
        ok: true,
        gatewayId: payload.gatewayId,
        batchId: batch._id,
        status,
        summary,
    };
}