import express from 'express';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import chalk from 'chalk';
import cookieParser from 'cookie-parser';
import path from 'path';

// import productionRoutes from './routes/productionRoutes.js';
import producttypeRoutes from './routes/producttypeRoutes.js';
import parameterRoutes from './routes/parameterRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import batchesRouter from './routes/batchesRoutes.js';
import partyRouter from './routes/partyRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js'
import itemRoutes from './routes/itemsRoutes.js'
import companyRoutes from './routes/companyRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import gatewayRoutes from './routes/gatewayRoutes.js';
import { inviteRoutes, inviteAuthRoutes, settingRoutes} from './routes/usersRoutes.js';
import { startBounceWatcher } from './services/bounceWatcher.js';
import { fileURLToPath } from 'url';
import permissionsRoute from './routes/permissionsRoute.js';
// import { initGlobalErrorHandlers, expressErrorHandler } from './utils/errorHandler.js';
// initGlobalErrorHandlers({ logger: console, exitOnFatal: false });

// after all routes:
// Load env variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();

// Robust path resolution for uploads directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cwd = process.cwd();
// If started from backend-api, use that; otherwise use <root>/backend-api
const uploadsBase = path.basename(cwd) === 'backend-api' ? cwd : path.join(cwd, 'backend-api');
const uploadsDir = path.join(uploadsBase, 'uploads');
// console.log('[Static] Serving /uploads from:', uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Middlewaremm
// app.use(cors());
app.use(express.json());

// Use CORS middleware to allow requests from the frontend
console.log(chalk.green("CLIENT_URL ***** : ", process.env.CLIENT_URL));
app.use(cors({
  origin: process.env.CLIENT_URL,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true, // because you send cookies
}));
app.use(cookieParser());

// Basic test route in server.js
app.get('/', (req, res) => {
  res.send('Backend server is running');
});

// app.use(expressErrorHandler({ logger: console }));

// Use routes
app.use('/auth',authRoutes); // This makes the route http://localhost:5000/api/send-contact-email
// app.use('/api', productionRoutes);
// app.use('/api/raw', rawmaterialRoutes);
app.use('/api/product-type', producttypeRoutes);
app.use('/api', parameterRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/batches', batchesRouter);
app.use('/api/parties', partyRouter);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/users', inviteRoutes);
app.use('/api/permissions', permissionsRoute);
app.use('/api/myaccount', settingRoutes);
app.use('/', inviteAuthRoutes);
// /api/gateway/blanket/production
app.use("/gateway", gatewayRoutes); 
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(chalk.green(`🚀 Server running on http://localhost:${PORT}`));
});

// // Start IMAP bounce watcher (optional; runs only if creds are present)
// (async () => {
//   try {
//     if (process.env.MAIL_FROM && process.env.SMTP_PASS) {
//       await startBounceWatcher(console);
//     } else {
//       console.warn('IMAP credentials missing — bounce watcher not started.');
//     }
//   } catch (e) {
//     console.error('Bounce watcher failed to start:', e);
//   }
// })();