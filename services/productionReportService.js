// services/productionReportService.js

import RawMaterial from '../models/Rawmaterial.js';
import ProductionBlanketRoll from '../models/ProductionBlanketRoll.js';
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

    const startIST = reportDate.minus({ days: 1 }).set({
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

        return {range: { startIST, endIST }, data};
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

        console.log('Report range:', reportRange);

        console.dir(report, {
            depth: null,
        });

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