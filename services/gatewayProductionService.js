import mongoose from "mongoose";
import GatewayIngestBatch from "../models/GatewayIngestBatch.js";
import ProductionBlanketRoll from "../models/ProductionBlanketRoll.js";
import Item from "../models/Item.js";
import { receive as invReceive } from "../services/inventoryService.js";
import Temperature from "../models/Temperature.js";
import Density from "../models/Density.js";
import Dimension from "../models/Dimension.js";
import ProductType from "../models/ProductType.js";
import Warehouse from "../models/Warehouse.js";
import { AppError, handleError } from "../utils/errorHandler.js";

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

async function resolveWarehouseId() {
  // Prefer an explicit fixed warehouse for gateway receipts
  const fixedId = process.env.GATEWAY_WAREHOUSE_ID;
  if (fixedId) return fixedId;

  const fixedCode = process.env.GATEWAY_WAREHOUSE_CODE;
  if (fixedCode) {
    const wh = await Warehouse.findOne({ code: fixedCode }).lean();
    return wh?._id || null;
  }

  const fixedName = process.env.GATEWAY_WAREHOUSE_NAME;
  if (fixedName) {
    const wh = await Warehouse.findOne({ name: { $regex: new RegExp(`^${fixedName}$`, "i") } }).lean();
    return wh?._id || null;
  }

  // Fallback: pick the first/oldest warehouse
  const wh = await Warehouse.findOne({}).sort({ createdAt: 1 }).lean();
  return wh?._id || null;
}

async function resolvePackingItem(companyId) {
    // by name mapping (your request)
    const packing = await Item.findOne({
        companyId,
        categoryKey: "PACKING",
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
    // 2: "bulk",
    // 3: "board",
    // 4: "module",
  };

  const name = PRODUCT_CODE_MAP[productCode];
  if (!name) return { id: null, err: `Unsupported productCode: ${productCode}` };

  // ProductType schema only has `name` (lowercased enum)
  const pt = await ProductType?.findOne({ name }).lean();

  if (!pt) return { id: null, err: `ProductType '${name}' not found in DB` };
  return { id: pt._id, err: null };
}

// async function resolveTempDensity(companyId, temperatureValue, densityValue) {
//     const errs = [];
//     const temp = await Temperature?.findOne({ companyId, value: temperatureValue }).lean();
//     if (!temp) errs.push(`Temperature not found for value ${temperatureValue}`);

//     const dens = await Density?.findOne({ companyId, value: densityValue }).lean();
//     if (!dens) errs.push(`Density not found for value ${densityValue}`);

//     return { tempId: temp?._id || null, densId: dens?._id || null, errs };
// }

async function resolveTempDensity({ productTypeId, temperatureValue, densityValue }) {
  const errs = [];

  if (!productTypeId) {
    return {
      tempId: null,
      densId: null,
      errs: ["productTypeId is required to resolve temperature/density"],
    };
  }

  const tVal = Number(temperatureValue);
  const dVal = Number(densityValue);

  const temp = await Temperature?.findOne({ productType: productTypeId, value: tVal }).lean();
  if (!temp) errs.push(`Temperature not found for productType ${productTypeId} value ${tVal}`);

  const dens = await Density?.findOne({ productType: productTypeId, value: dVal }).lean();
  if (!dens) errs.push(`Density not found for productType ${productTypeId} value ${dVal}`);

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
        status: { $in: ["active", "approved"] },
    }).select("_id UOM name").lean();

    // fallback: allow packing mismatch (in case FG items were created without packing)
    if (!item) {
        item = await Item.findOne({
            companyId,
            categoryKey: "FG",
            productType: productTypeId,
            temperature: temperatureId,
            density: densityId,
            dimension: dimensionId,
            status: { $in: ["active", "approved"] },
        }).select("_id UOM name").lean();
    }

    return item;
}

export async function ingestBlanketBatch({ companyId, payload }) {
  try {
    if (!companyId) {
      throw new AppError("companyId is required for gateway ingestion", { statusCode: 400, code: "MISSING_COMPANY" });
    }

    const { gatewayId, sentAt, records } = payload || {};
    if (!gatewayId) {
      throw new AppError("gatewayId is required", { statusCode: 400, code: "MISSING_GATEWAY" });
    }
    if (!Array.isArray(records)) {
      throw new AppError("records must be an array", { statusCode: 400, code: "INVALID_PAYLOAD" });
    }

    const batch = await GatewayIngestBatch.create({
        companyId,
        gatewayId,
        sentAt: safeDate(sentAt),
        recordsCount: records.length,
        rawPayload: payload,
        processingStatus: "RECEIVED",
    });

    const warehouseId = await resolveWarehouseId();
    const packingId = await resolvePackingItem(companyId);
    if (!warehouseId) console.warn("[gateway] No warehouse found (set GATEWAY_WAREHOUSE_ID/CODE/NAME)");
    if (!packingId) console.warn("[gateway] Packing item not found by name 'plastic bag' for companyId", companyId);

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

        const { id: productTypeId, err: ptErr } = await resolveProductType(productCode);
        if (ptErr) resolveErrors.push(ptErr);

        let dimensionId = null;
        let temperatureId = null;
        let densityId = null;

        if (productTypeId) {
          const dimRes = await resolveDimension({ productTypeId, sizeCode });
          dimensionId = dimRes.id;
          if (dimRes.err) resolveErrors.push(dimRes.err);

          const tdRes = await resolveTempDensity({ productTypeId, temperatureValue, densityValue });
          temperatureId = tdRes.tempId;
          densityId = tdRes.densId;
          if (tdRes.errs?.length) resolveErrors.push(...tdRes.errs);
        } else {
          resolveErrors.push("productTypeId not resolved; skipping dimension/temperature/density resolution");
        }

        for (const it of items) {
            const scaleNo = Number(it?.scaleNo);
            const weightKg = Number(it?.weight || 0);
            const statusOk = normalizeStatus(it?.status);
            console.log('it?.status', it?.status);

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
                
                console.log('shouldPost', shouldPost, statusOk);

                if (!shouldPost) {
                  // Not an error: just track why no inventory
                  // statusOk false or weightKg <= 0
                  continue;
                }
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
                        { $push: { resolveErrors: `FG Item not found for specs: productType=${productTypeId} temp=${temperatureId} density=${densityId} dimension=${dimensionId} packing=${packingId}` } }
                    );
                    continue;
                }

                // post inventory as qty=1 roll
                const invRes = await invReceive({
                    companyId,
                    itemId: matchedItem._id,
                    warehouseId,
                    uom: matchedItem.UOM || "roll",
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
  } catch (error) {
    // Attach context for easier debugging
    error.context = {
      service: "gatewayProductionService.ingestBlanketBatch",
      at: new Date().toISOString(),
    };
    return handleError(res, error);
    // throw error; // controller will handle via handleError(res, error)
  }
}