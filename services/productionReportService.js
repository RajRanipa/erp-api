// services/productionReportService.js
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import Batch from '../models/Batches.js';
import { DateTime } from 'luxon';
import sendMail from '../utils/sendMail.js';
import generatePdfFromHtml from '../utils/generatePdfFromHtml.js';
import { sendProductionReport } from './whatsappService.js';
import mongoose from "mongoose";

// 1. Generate a PDF from your existing HTML
// 2. Generate the short WhatsApp summary text
// 3. Connect the Meta WhatsApp Cloud API
// 4. Call email + WhatsApp from fetchAndSendReport()

const REPORT_TIMEZONE = 'Asia/Kolkata';

const MASS_TO_KG = {
    mg: 0.000001,
    g: 0.001,
    kg: 1,
    lb: 0.45359237,
    lbs: 0.45359237,
    pound: 0.45359237,
    tonne: 1000,
    ton: 1000,
    t: 1000,
};

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

export const  getTodayDayShiftRange = (date = null) => {
    const reportDate = parseReportDate(date);

    const startIST = reportDate.set({
        hour: 7,
        minute: 30,
        second: 0,
        millisecond: 0,
    });

    const endIST = reportDate.set({
        hour: 19,
        minute: 30,
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

    const startIST = reportDate.minus({ days: 1 }).set({
        hour: 19,
        minute: 30,
        second: 0,
        millisecond: 0,
    });

    const endIST = reportDate.set({
        hour: 7,
        minute: 30,
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

    const productionMatch = {
        at: { $gte: start, $lt: end },
        matchedItem: { $ne: null },
    };
    if (companyId) {
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            throw new Error('Valid companyId is required');
        }
        productionMatch.companyId = new mongoose.Types.ObjectId(companyId);
    }

    const data = await ProductionBlanketRoll.aggregate([
        // 1. FILTER
        {
            $match: productionMatch,
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

    // console.log("fetchproduction data ::::::: ", data);
    return data;
}

const quantityToKg = (quantity, unit) => {
    const value = Number(quantity);
    const factor = MASS_TO_KG[String(unit || '').trim().toLowerCase()];

    if (!Number.isFinite(value) || !factor) {
        return 0;
    }

    return value * factor;
};

/**
 * Returns manufacturing batches recorded inside the same time window used by
 * the production report. `createdAt` answers when the batch was actually
 * recorded/made; `date` remains the operator-selected manufacturing date.
 */
export const fetchBatchReport = async (start, end, companyId = null) => {
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
        throw new Error('Valid batch report start date is required');
    }

    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
        throw new Error('Valid batch report end date is required');
    }

    const match = {
        createdAt: { $gte: start, $lt: end },
    };

    if (companyId) {
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            throw new Error('Valid companyId is required');
        }
        match.companyId = new mongoose.Types.ObjectId(companyId);
    }

    const batches = await Batch.find(match)
        .select(
            'batche_id date numbersBatches companyId campaign warehouseId '
            + 'rawMaterials createdAt',
        )
        .populate({
            path: 'campaign',
            select: 'name status',
        })
        .populate({
            path: 'warehouseId',
            select: 'name code',
        })
        .populate({
            path: 'rawMaterials.itemId',
            select: (
                'name sku grade UOM categoryKey description '
                + 'raw_specificField1 raw_specificField2'
            ),
        })
        .sort({ createdAt: 1, batche_id: 1 })
        .lean();

    const rows = batches.map(batch => {
        const batchCount = Number(batch.numbersBatches) || 0;
        const materials = (batch.rawMaterials || []).map(line => {
            const quantityPerBatch = Number(line.weight) || 0;
            const perBatchUom = line.unit || line.itemId?.UOM || '-';
            const totalQuantity = (
                Number(line.issuedQuantity)
                || quantityPerBatch * batchCount
            );
            const totalUom = line.issuedUom || line.itemId?.UOM || perBatchUom;

            return {
                itemId: line.itemId?._id || line.itemId || null,
                name: line.itemId?.name || 'Unknown item',
                sku: line.itemId?.sku || '',
                grade: line.itemId?.grade || '',
                description: line.itemId?.description || '',
                specification1: line.itemId?.raw_specificField1 || '',
                specification2: line.itemId?.raw_specificField2 || '',
                quantityPerBatch,
                perBatchUom,
                totalQuantity,
                totalUom,
            };
        });

        const totalRawKg = (batch.rawMaterials || []).reduce(
            (sum, line) => sum + quantityToKg(
                (Number(line.weight) || 0) * batchCount,
                line.unit,
            ),
            0,
        );

        return {
            id: batch._id,
            batchCode: batch.batche_id,
            manufacturingDate: batch.date,
            recordedAt: batch.createdAt,
            numberOfBatches: batchCount,
            campaign: batch.campaign?.name || '-',
            campaignStatus: batch.campaign?.status || '',
            warehouse: batch.warehouseId?.name || '-',
            warehouseCode: batch.warehouseId?.code || '',
            totalRawKg,
            materials,
        };
    });

    return {
        totalBatchRecords: rows.length,
        totalBatches: rows.reduce(
            (sum, batch) => sum + batch.numberOfBatches,
            0,
        ),
        totalRawKg: rows.reduce(
            (sum, batch) => sum + batch.totalRawKg,
            0,
        ),
        rows,
    };
};

export const fetchproductionALL = async (start, end, companyId) => {
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
        throw new Error("Valid start date is required");
    }

    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
        throw new Error("Valid end date is required");
    }

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
        throw new Error("Valid companyId is required");
    }

    console.log(
        "fetchproductionALL called with start:",
        start,
        "end:",
        end,
        "companyId:",
        companyId
    );

    const data = await ProductionBlanketRoll.aggregate([
        // 1. FILTER INDIVIDUAL PRODUCTION RECORDS
        {
            $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                at: {
                    $gte: start,
                    $lt: end,
                },
                matchedItem: {
                    $ne: null,
                },
            },
        },

        // 2. POPULATE PRODUCT TYPE
        {
            $lookup: {
                from: "producttypes",
                localField: "productType",
                foreignField: "_id",
                as: "productType",
            },
        },
        {
            $unwind: {
                path: "$productType",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 3. POPULATE TEMPERATURE
        {
            $lookup: {
                from: "temperatures",
                localField: "temperature",
                foreignField: "_id",
                as: "temperature",
            },
        },
        {
            $unwind: {
                path: "$temperature",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 4. POPULATE DENSITY
        {
            $lookup: {
                from: "densities",
                localField: "density",
                foreignField: "_id",
                as: "density",
            },
        },
        {
            $unwind: {
                path: "$density",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 5. POPULATE DIMENSION
        {
            $lookup: {
                from: "dimensions",
                localField: "dimension",
                foreignField: "_id",
                as: "dimension",
            },
        },
        {
            $unwind: {
                path: "$dimension",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 6. POPULATE PACKING ITEM
        {
            $lookup: {
                from: "items",
                localField: "packingItem",
                foreignField: "_id",
                as: "packingItem",
            },
        },
        {
            $unwind: {
                path: "$packingItem",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 7. POPULATE MATCHED ITEM
        {
            $lookup: {
                from: "items",
                localField: "matchedItem",
                foreignField: "_id",
                as: "matchedItem",
            },
        },
        {
            $unwind: {
                path: "$matchedItem",
                preserveNullAndEmptyArrays: true,
            },
        },

        // 8. RETURN INDIVIDUAL PRODUCTION DATA
        {
            $project: {
                _id: 1,

                companyId: 1,
                campaign: 1,
                gatewayId: 1,
                recordId: 1,
                ingestBatchId: 1,

                at: 1,
                weightKg: {
                    $ifNull: ["$weightKg", 0],
                },
                statusOk: 1,

                productCode: 1,
                temperatureValue: 1,
                densityValue: 1,
                sizeCode: 1,
                batchNo: 1,
                scaleNo: 1,

                resolveErrors: 1,

                matchedItem: 1,
                productType: 1,
                temperature: 1,
                density: 1,
                dimension: 1,
                packingItem: 1,

                createdAt: 1,
                updatedAt: 1,
            },
        },

        // 9. SORT BY PRODUCTION TIME
        {
            $sort: {
                at: 1,
            },
        },
    ]);

    return data;
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}


function formatDimension(dimension) {
    if (!dimension) return '-';

    const {
        length,
        width,
        thickness,
        unit = 'mm',
    } = dimension;

    return `${length ?? '-'} × ${width ?? '-'} × ${thickness ?? '-'} ${unit}`;
}

function formatReportDate(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
}

function formatReportDateTime(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}

function buildProductionReportSummary(
    report,
    timeOfDay,
    reportRange,
    batchReport,
) {
    const totals = report.reduce(
        (summary, item) => {
            const rolls = Number(item.totalRolls) || 0;
            const weight = Number(item.totalWeight) || 0;

            summary.totalRolls += rolls;
            summary.totalWeight += weight;

            if (item.statusOk) {
                summary.okRolls += rolls;
                summary.okWeight += weight;
            } else {
                summary.rejectedRolls += rolls;
                summary.rejectedWeight += weight;
            }

            return summary;
        },
        {
            totalRolls: 0,
            totalWeight: 0,
            okRolls: 0,
            okWeight: 0,
            rejectedRolls: 0,
            rejectedWeight: 0,
        },
    );

    const formatWeight = value =>
        Number(value || 0).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });

    const lines = [
        `🏭 JNR ERP - ${timeOfDay} Shift Production Report`,
        '',
        `📅 Report date: ${formatReportDate(
            reportRange.startIST,
        )}`,
        `⏰ Period: ${formatReportDateTime(
            reportRange.startIST,
        )} to ${formatReportDateTime(
            reportRange.endIST,
        )} IST`,
        '',
        `📦 Total Rolls: ${totals.totalRolls.toLocaleString(
            'en-IN',
        )}`,
        `⚖️ Total Weight: ${formatWeight(
            totals.totalWeight,
        )} kg`,
        '',
        `✅ OK: ${totals.okRolls.toLocaleString(
            'en-IN',
        )} rolls / ${formatWeight(totals.okWeight)} kg`,
        `❌ Rejected: ${totals.rejectedRolls.toLocaleString(
            'en-IN',
        )} rolls / ${formatWeight(
            totals.rejectedWeight,
        )} kg`,
        '',
        '🧪 MANUFACTURING BATCHES',
        `Batch entries: ${Number(
            batchReport?.totalBatchRecords || 0,
        ).toLocaleString('en-IN')}`,
        `Batches made: ${Number(
            batchReport?.totalBatches || 0,
        ).toLocaleString('en-IN')}`,
        `Raw material issued: ${formatWeight(
            batchReport?.totalRawKg,
        )} kg`,
    ];

    const maximumSummaryLength = 3500;
    let detailsTruncated = false;

    for (const batch of batchReport?.rows || []) {
        const batchLines = [
            '',
            `• ${batch.batchCode} — ${batch.numberOfBatches} batches`,
            `  Campaign: ${batch.campaign} | Warehouse: ${batch.warehouse}`,
        ];

        for (const material of batch.materials || []) {
            const specifications = [
                material.grade ? `grade ${material.grade}` : '',
                material.specification1,
                material.specification2,
            ].filter(Boolean).join(', ');
            const specificationText = specifications
                ? ` (${specifications})`
                : '';

            batchLines.push(
                `  - ${material.name}${specificationText}: `
                + `${formatWeight(material.quantityPerBatch)} `
                + `${material.perBatchUom}/batch; total `
                + `${formatWeight(material.totalQuantity)} `
                + `${material.totalUom}`,
            );
        }

        const candidate = [...lines, ...batchLines].join('\n');
        if (candidate.length > maximumSummaryLength) {
            detailsTruncated = true;
            break;
        }

        lines.push(...batchLines);
    }

    if (detailsTruncated) {
        lines.push('', 'More batch specifications are included in the PDF.');
    }

    lines.push(
        '',
        '📄 Detailed production and batch report attached.',
        '',
        'Automatically generated by JNR ERP',
    );

    return lines.join('\n');
}

export const getProductionDay = async (date = null, companyId = null) => {
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

        const [data, batchReport] = await Promise.all([
            fetchproduction(start, end, companyId),
            fetchBatchReport(start, end, companyId),
        ]);

        return {
            range: { startIST, endIST },
            data,
            batchReport,
        };
    } catch (error) {
        throw new Error('Production day report error', {
            cause: error,
        });
    }
}

function formatReportNumber(value) {
    return Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function buildBatchReportHtml(batchReport) {
    const batches = batchReport?.rows || [];

    if (batches.length === 0) {
        return `
            <div style="margin-top:28px;">
                <h2 style="margin-bottom:10px;">Manufacturing Batch Report</h2>
                <div
                    style="
                        padding:16px;
                        border:1px solid #ddd;
                        background:#f8f9fa;
                        color:#555;
                    "
                >
                    No manufacturing batches were recorded during this shift.
                </div>
            </div>
        `;
    }

    const rows = batches.map((batch, index) => {
        const materials = (batch.materials || []).map(material => {
            const specifications = [
                material.sku ? `SKU: ${material.sku}` : '',
                material.grade ? `Grade: ${material.grade}` : '',
                material.specification1,
                material.specification2,
                material.description,
            ].filter(Boolean);

            return `
                <div style="margin-bottom:8px;">
                    <strong>${escapeHtml(material.name)}</strong>
                    ${specifications.length
                        ? `<div style="font-size:11px;color:#555;">
                            ${escapeHtml(specifications.join(' | '))}
                        </div>`
                        : ''}
                    <div style="font-size:11px;">
                        ${formatReportNumber(material.quantityPerBatch)}
                        ${escapeHtml(material.perBatchUom)} per batch
                        &nbsp;·&nbsp;
                        Total ${formatReportNumber(material.totalQuantity)}
                        ${escapeHtml(material.totalUom)}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <tr>
                <td style="padding:9px;border:1px solid #ddd;">${index + 1}</td>
                <td style="padding:9px;border:1px solid #ddd;">
                    <strong>${escapeHtml(batch.batchCode)}</strong>
                    <div style="font-size:11px;color:#666;">
                        Recorded ${escapeHtml(formatReportDateTime(batch.recordedAt))}
                    </div>
                </td>
                <td style="padding:9px;border:1px solid #ddd;">
                    ${escapeHtml(formatReportDate(batch.manufacturingDate))}
                </td>
                <td style="padding:9px;border:1px solid #ddd;">
                    ${escapeHtml(batch.campaign)}
                </td>
                <td style="padding:9px;border:1px solid #ddd;">
                    ${escapeHtml(batch.warehouse)}
                    ${batch.warehouseCode
                        ? `<div style="font-size:11px;color:#666;">
                            ${escapeHtml(batch.warehouseCode)}
                        </div>`
                        : ''}
                </td>
                <td
                    style="
                        padding:9px;
                        border:1px solid #ddd;
                        text-align:right;
                        font-weight:bold;
                    "
                >
                    ${Number(batch.numberOfBatches || 0).toLocaleString('en-IN')}
                </td>
                <td style="padding:9px;border:1px solid #ddd;">
                    ${materials || '-'}
                </td>
                <td style="padding:9px;border:1px solid #ddd;text-align:right;">
                    ${formatReportNumber(batch.totalRawKg)} kg
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div style="margin-top:28px;page-break-before:auto;">
            <h2 style="margin-bottom:10px;">Manufacturing Batch Report</h2>

            <table
                style="
                    width:100%;
                    border-collapse:collapse;
                    margin:12px 0 18px;
                "
            >
                <tr>
                    <td style="padding:12px;border:1px solid #ddd;background:#f5f5f5;">
                        <strong>Batch Entries</strong><br>
                        ${Number(batchReport.totalBatchRecords || 0).toLocaleString('en-IN')}
                    </td>
                    <td style="padding:12px;border:1px solid #ddd;background:#e3f2fd;">
                        <strong>Total Batches Made</strong><br>
                        ${Number(batchReport.totalBatches || 0).toLocaleString('en-IN')}
                    </td>
                    <td style="padding:12px;border:1px solid #ddd;background:#fff8e1;">
                        <strong>Total Raw Material Issued</strong><br>
                        ${formatReportNumber(batchReport.totalRawKg)} kg
                    </td>
                </tr>
            </table>

            <table
                style="
                    width:100%;
                    border-collapse:collapse;
                    font-size:12px;
                "
            >
                <thead>
                    <tr style="background:#37474f;color:white;">
                        <th style="padding:9px;border:1px solid #ddd;">#</th>
                        <th style="padding:9px;border:1px solid #ddd;">Batch ID</th>
                        <th style="padding:9px;border:1px solid #ddd;">Batch Date</th>
                        <th style="padding:9px;border:1px solid #ddd;">Campaign</th>
                        <th style="padding:9px;border:1px solid #ddd;">Warehouse</th>
                        <th style="padding:9px;border:1px solid #ddd;">Made</th>
                        <th style="padding:9px;border:1px solid #ddd;">Material Specification</th>
                        <th style="padding:9px;border:1px solid #ddd;">Raw Total</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// 
function buildProductionReportHtml(
    report,
    timeOfDay,
    reportRange,
    batchReport,
) {
    const totals = report.reduce(
        (summary, item) => {
            const rolls = Number(item.totalRolls) || 0;
            const weight = Number(item.totalWeight) || 0;

            summary.totalRolls += rolls;
            summary.totalWeight += weight;

            if (item.statusOk) {
                summary.okRolls += rolls;
                summary.okWeight += weight;
            } else {
                summary.rejectedRolls += rolls;
                summary.rejectedWeight += weight;
            }

            return summary;
        },
        {
            totalRolls: 0,
            totalWeight: 0,
            okRolls: 0,
            okWeight: 0,
            rejectedRolls: 0,
            rejectedWeight: 0,
        },
    );

    const rows = report
        .map((item, index) => {
            const statusText = item.statusOk
                ? 'OK'
                : 'Rejected';

            const statusStyle = item.statusOk
                ? 'background:#e8f5e9;color:#1b5e20;'
                : 'background:#ffebee;color:#b71c1c;';

            const temperature = [
                item.temperature?.value,
                item.temperature?.unit,
            ]
                .filter(value => value !== undefined && value !== null)
                .join(' ') || '-';

            const density = [
                item.density?.value,
                item.density?.unit,
            ]
                .filter(value => value !== undefined && value !== null)
                .join(' ') || '-';

            return `
                <tr>
                    <td style="padding:10px;border:1px solid #ddd;">
                        ${index + 1}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;">
                        <strong>
                            ${escapeHtml(item.matchedItem?.name || '-')}
                        </strong>
                        <br>

                        <span style="font-size:12px;color:#666;">
                            ${escapeHtml(item.matchedItem?.sku || '-')}
                        </span>
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;">
                        ${escapeHtml(temperature)}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;">
                        ${escapeHtml(density)}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;">
                        ${escapeHtml(formatDimension(item.dimension))}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;">
                        ${escapeHtml(item.packingItem?.name || '-')}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;text-align:center;">
                        <span
                            style="
                                ${statusStyle}
                                padding:4px 8px;
                                border-radius:4px;
                                font-weight:bold;
                            "
                        >
                            ${statusText}
                        </span>
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;text-align:right;">
                        ${Number(item.totalRolls || 0).toLocaleString('en-IN')}
                    </td>

                    <td style="padding:10px;border:1px solid #ddd;text-align:right;">
                        ${Number(item.totalWeight || 0).toLocaleString(
                'en-IN',
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                },
            )} kg
                    </td>
                </tr>
            `;
        })
        .join('');
    const batchReportHtml = buildBatchReportHtml(batchReport);

    return `
        <div
            style="
                font-family:Arial,sans-serif;
                color:#222;
                max-width:1200px;
                margin:0 auto;
            "
        >
            <h2 style="margin-bottom:4px;">
                ${escapeHtml(timeOfDay)} Shift Production Report
            </h2>

            <div
                style="
                    margin:12px 0 18px;
                    padding:12px;
                    background:#f5f7f9;
                    border-left:4px solid #263238;
                "
            >
                <div style="margin-bottom:6px;">
                    <strong>Report date:</strong>
                    ${escapeHtml(
        formatReportDate(reportRange.startIST),
    )}
                </div>

                <div>
                    <strong>Production period:</strong>
                    ${escapeHtml(
        formatReportDateTime(reportRange.startIST),
    )}
                    to
                    ${escapeHtml(
        formatReportDateTime(reportRange.endIST),
    )}
                    IST
                </div>
            </div>

            <p style="margin:8px 0 0;color:#666;">
                Automatically generated by JNR ERP
            </p>

            <table
                style="
                    width:100%;
                    border-collapse:collapse;
                    margin:20px 0;
                "
            >
                <tr>
                    <td
                        style="
                            padding:12px;
                            border:1px solid #ddd;
                            background:#f5f5f5;
                        "
                    >
                        <strong>Total Rolls</strong>
                        <br>
                        ${totals.totalRolls.toLocaleString('en-IN')}
                    </td>

                    <td
                        style="
                            padding:12px;
                            border:1px solid #ddd;
                            background:#f5f5f5;
                        "
                    >
                        <strong>Total Weight</strong>
                        <br>
                        ${totals.totalWeight.toLocaleString(
        'en-IN',
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        },
    )} kg
                    </td>

                    <td
                        style="
                            padding:12px;
                            border:1px solid #ddd;
                            background:#e8f5e9;
                        "
                    >
                        <strong>OK Production</strong>
                        <br>
                        ${totals.okRolls.toLocaleString('en-IN')} rolls
                        /
                        ${totals.okWeight.toLocaleString(
        'en-IN',
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        },
    )} kg
                    </td>

                    <td
                        style="
                            padding:12px;
                            border:1px solid #ddd;
                            background:#ffebee;
                        "
                    >
                        <strong>Rejected</strong>
                        <br>
                        ${totals.rejectedRolls.toLocaleString('en-IN')} rolls
                        /
                        ${totals.rejectedWeight.toLocaleString(
        'en-IN',
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        },
    )} kg
                    </td>
                </tr>
            </table>

            <div style="overflow-x:auto;">
                <table
                    style="
                        width:100%;
                        border-collapse:collapse;
                        font-size:13px;
                    "
                >
                    <thead>
                        <tr style="background:#263238;color:white;">
                            <th style="padding:10px;border:1px solid #ddd;">
                                #
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Item
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Temperature
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Density
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Dimension
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Packing
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Status
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Rolls
                            </th>

                            <th style="padding:10px;border:1px solid #ddd;">
                                Weight
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>

            ${batchReportHtml}
        </div>
    `;
}

export const getProductionNight = async (date = null, companyId = null) => {
    try {

        const {
            start,
            end,
            startIST,
            endIST,
        } = getTodayNightShiftRange(date);

        // console.log('Production report range:', {
        //     startIST,
        //     endIST,
        //     startUTC: start.toISOString(),
        //     endUTC: end.toISOString(),
        // });

        const [data, batchReport] = await Promise.all([
            fetchproduction(start, end, companyId),
            fetchBatchReport(start, end, companyId),
        ]);

        return {
            range: { startIST, endIST },
            data,
            batchReport,
        };
    } catch (error) {
        throw new Error('Production night report error', {
            cause: error,
        });
    }

}

function normalizeRecipients(to) {
    let recipients;

    if (Array.isArray(to)) {
        recipients = to;
    } else if (typeof to === 'string') {
        recipients = to
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(number => number.trim())
            .filter(Boolean);
    } else {
        recipients = [to];
    }

    const normalizedRecipients = recipients.map(recipient =>
        String(recipient).replace(/\D/g, '')
    );

    if (normalizedRecipients.length === 0) {
        throw new Error(
            'At least one WhatsApp recipient is required',
        );
    }

    for (const recipient of normalizedRecipients) {
        if (!/^\d{10,15}$/.test(recipient)) {
            throw new Error(
                `Invalid WhatsApp recipient number: ${recipient}`,
            );
        }
    }

    return normalizedRecipients;
}
// 1. Create the core function that fetches data and sends the email
export async function fetchAndSendReport(timeOfDay) {
    try {
        console.log(`🚀 Starting ${timeOfDay} scheduled task...`);

        // --- STEP A: Fetch data from your database ---
        // (Replace this dummy data with your actual DB query)
        // Example: const users = await db.collection('users').find({ wantsUpdates: true }).toArray();
        let productionReport;

        if (timeOfDay === 'NIGHT') {
            productionReport = await getProductionNight();
        }

        if (timeOfDay === 'DAY') {
            productionReport = await getProductionDay();
        }

        const report = productionReport?.data ?? [];
        const reportRange = productionReport?.range ?? null;
        const batchReport = productionReport?.batchReport ?? {
            totalBatchRecords: 0,
            totalBatches: 0,
            totalRawKg: 0,
            rows: [],
        };


        // --- STEP B: Loop through the data and send emails ---
        console.log('==================================================');

        const hasProduction = Array.isArray(report) && report.length > 0;
        const hasBatches = batchReport.totalBatchRecords > 0;

        if (!hasProduction && !hasBatches) {
            console.log(
                `⚠️ No ${timeOfDay} production or batch data found. Report skipped.`,
            );
            return {
                success: true,
                skipped: true,
                emailSent: false,
                whatsappSent: 0,
                message: `No ${timeOfDay} production or batch data found`,
            };
        }

        if (!reportRange?.startIST || !reportRange?.endIST) {
            throw new Error(
                'Production report range is missing',
            );
        }

        const recipientEmail = (
            process.env.PRODUCTION_REPORT_EMAIL
            || 'orientfibertechllp@gmail.com'
        );
        // const recipientEmail = "rajranipa47@gmail.com";

        if (!recipientEmail) {
            throw new Error(
                'PRODUCTION_REPORT_EMAIL is not configured',
            );
        }

        const emailHtml = buildProductionReportHtml(
            report,
            timeOfDay,
            reportRange,
            batchReport,
        );

        const pdfBuffer = await generatePdfFromHtml(
            emailHtml,
        );

        const whatsappSummary = buildProductionReportSummary(
            report,
            timeOfDay,
            reportRange,
            batchReport,
        );

        const reportDate = DateTime.fromISO(
            reportRange.startIST,
            {
                zone: REPORT_TIMEZONE,
            },
        ).toFormat('dd-LL-yyyy');

        const filename = (
            `JNR-PR-`
            + `${timeOfDay.toLowerCase()}-`
            + `${reportDate}.pdf`
        );

        console.log(
            `📄 ${timeOfDay} report PDF generated:`,
            `${pdfBuffer.length} bytes`,
        );
        console.log('WhatsApp summary preview:\n');
        console.log(whatsappSummary);

        await sendMail({
            to: recipientEmail,
            subject: (
                `JNR ERP: ${timeOfDay} Shift Production & Batch Report - `
                + `${formatReportDate(reportRange.startIST)} to `
                + `${formatReportDate(reportRange.endIST)}`
            ),
            html: emailHtml,
        });

        let whatsappSent = 0;

        let recipients = [];

        if (process.env.WHATSAPP_RECIPIENT_NUMBER) {
            recipients = normalizeRecipients(
                process.env.WHATSAPP_RECIPIENT_NUMBER,
            );
        }
        console.log('recipients :-- ', recipients);

        for (const to of recipients) {
            try {
                await sendProductionReport({
                    to,
                    summary: whatsappSummary,
                    pdfBuffer,
                    filename,
                    shift: timeOfDay,
                });
                whatsappSent += 1;
            } catch (error) {
                console.error(
                    `Failed to send report to ${to}`,
                    error,
                );
            }
        }

        console.log(
            `✅ ${timeOfDay} production report sent to ${recipientEmail}`,
        );

        return {
            success: true,
            emailSent: true,
            whatsappSent,
            message: whatsappSent
                ? `${timeOfDay} report sent by email and WhatsApp to ${whatsappSent} of ${recipients.length} recipients`
                : recipients.length
                    ? `${timeOfDay} report sent by email; WhatsApp delivery failed`
                    : `${timeOfDay} report sent by email; no WhatsApp recipients configured`,
        };
    } catch (error) {
        console.error(
            `❌ Error in ${timeOfDay} scheduled task:`,
            error,
        );
        throw error;
    }
}
