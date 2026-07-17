// services/productionReportService.js

import RawMaterial from '../models/Rawmaterial.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
import WorkOrder from '../models/WorkOrder.js'; // Import the new WorkOrder model
import Item from '../models/Item.js';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import sendMail from '../utils/sendMail.js';


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

    // console.log("fetchproduction data ::::::: ", data);
    return data;
}

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

export const getProductionDay = async (date = null) => {
    try {
        const {
            start,
            end,
            startIST,
            endIST,
        } = getTodayDayShiftRange(date);

        // console.log('Production report range:', {
        //     startIST,
        //     endIST,
        //     startUTC: start.toISOString(),
        //     endUTC: end.toISOString(),
        // });

        const data = await fetchproduction(start, end);

        return {range: { startIST, endIST }, data};
    } catch (error) {
        throw new Error('Production day report error', {
            cause: error,
        });
    }
}

function buildProductionReportHtml(report, timeOfDay, reportRange) {
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
                        ${escapeHtml(item.productType?.name || '-')}
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
                                Product Type
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
        </div>
    `;
}

export const getProductionNight = async (date = null) => {
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

        const data = await fetchproduction(start, end);

        return {range: { startIST, endIST }, data};
    } catch (error) {
        throw new Error('Production night report error:', error);
    }

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


        // --- STEP B: Loop through the data and send emails ---
        console.log('==================================================');

        // console.log('Report range:', reportRange);

        // console.dir(report, {
        //     depth: null,
        // });

        if (!Array.isArray(report) || report.length === 0) {
            console.log(
                `⚠️ No ${timeOfDay} production data found. Email skipped.`,
            );
            return;
        }

        if (!reportRange?.startIST || !reportRange?.endIST) {
            throw new Error(
                'Production report range is missing',
            );
        }

        const recipientEmail = "orientfibertechllp@gmail.com";

        if (!recipientEmail) {
            throw new Error(
                'PRODUCTION_REPORT_EMAIL is not configured',
            );
        }

        const emailHtml = buildProductionReportHtml(
            report,
            timeOfDay,
            reportRange,
        );

        await sendMail({
            to: recipientEmail,
            subject: (
                `JNR ERP: ${timeOfDay} Shift Production Report - `
                + `${formatReportDate(reportRange.startIST)} to `
                + `${formatReportDate(reportRange.endIST)}`
            ),
            html: emailHtml,
        });

        
        console.log(
            `✅ ${timeOfDay} production report sent to ${recipientEmail}`,
        );
        return {
            success: true,
            message: `${timeOfDay} production report sent to ${recipientEmail}`,
        };
    } catch (error) {
        console.error(`❌ Error in ${timeOfDay} scheduled task:`, error);
    }
}