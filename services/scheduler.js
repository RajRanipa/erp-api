import cron from 'node-cron';
import sendMail from '../utils/sendMail.js';
import r from '../routes/warehouseRoutes.js';
import { fetchAndSendReport, getProductionDay, getProductionNight } from './productionReportService.js';
// import { db } from './your-database-config.js'; // Import your DB connection here

// 2. Schedule the tasks using node-cron
export function startReportScheduler() {
    console.log('✅ Report scheduler initialized');

    cron.schedule('0 8 * * *', async () => {
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

    cron.schedule('0 20 * * *', async () => {
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







