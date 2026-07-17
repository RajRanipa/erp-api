import cron from 'node-cron';
import sendMail from '../utils/sendMail.js';
import r from '../routes/warehouseRoutes.js';
import { fetchAndSendReport, getProductionDay, getProductionNight } from './productionReportService.js';
// import { db } from './your-database-config.js'; // Import your DB connection here



// 2. Schedule the tasks using node-cron

export function startReportScheduler() {
    console.log('✅ Report scheduler initialized');

    cron.schedule('30 8 * * *', async () => {
        console.log('8:00 AM Task');
        try {
            await fetchAndSendReport('NIGHT');
        } catch (error) {
            console.error('❌ Report cron failed:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Adjust timezone as needed
    });

    cron.schedule('30 20 * * *', async () => {
        console.log('8:00 PM Task');
        try {
            await fetchAndSendReport('DAY');
        } catch (error) {
            console.error('❌ Report cron failed:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Adjust timezone as needed
    });
    console.log('⏰ Database Email Scheduler is now running...');
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