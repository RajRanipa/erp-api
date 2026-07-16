import cron from 'node-cron';
import sendMail from '../utils/sendMail.js';
import { getProductionReportAM, getProductionReportPM } from '../controllers/productionController.js';
// import { db } from './your-database-config.js'; // Import your DB connection here

// 1. Create the core function that fetches data and sends the email
async function fetchAndSendReport(timeOfDay) {
    try {
        console.log(`🚀 Starting ${timeOfDay} scheduled task...`);

        // --- STEP A: Fetch data from your database ---
        // (Replace this dummy data with your actual DB query)
        // Example: const users = await db.collection('users').find({ wantsUpdates: true }).toArray();
        let report;

        if (timeOfDay === 'PM') {
            report = await getProductionReportPM();
        }

        if (timeOfDay === 'AM') {
            report = await getProductionReportAM();
        }

        console.log('==================================================');
        console.log('report :- ', report);

        const dbData = [
            { email: 'target-recipient@example.com', name: 'John Doe', tasksCompleted: 5 }
        ];

        if (!dbData || dbData.length === 0) {
            console.log('⚠️ No data found in the database for this cycle.');
            return; // Stop execution if there's no data
        }

        // --- STEP B: Loop through the data and send emails ---
        for (const record of dbData) {

            // Construct the dynamic HTML using your DB data
            const emailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Hello ${record.name},</h2>
          <p>Here is your <strong>${timeOfDay}</strong> automated update from the JNR ERP System.</p>
          <p>Tasks completed: ${record.tasksCompleted}</p>
        </div>
      `;

            // Call your existing sendMail utility
            await sendMail({
                to: record.email,
                subject: `JNR ERP: Your ${timeOfDay} Update`,
                html: emailHtml
            });

            console.log(`✅ Automated email successfully sent to ${record.email}`);
        }

    } catch (error) {
        console.error(`❌ Error in ${timeOfDay} scheduled task:`, error);
    }
}

// 2. Schedule the tasks using node-cron

export function startReportScheduler() {
    console.log('✅ Report scheduler initialized');

    cron.schedule('30 8 * * *', async () => {
        console.log('8:00 AM Task');
        try {
            await fetchAndSendReport('PM');
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
            await fetchAndSendReport('AM');
        } catch (error) {
            console.error('❌ Report cron failed:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Adjust timezone as needed
    });
    console.log('⏰ Database Email Scheduler is now running...');
}
