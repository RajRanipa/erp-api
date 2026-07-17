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