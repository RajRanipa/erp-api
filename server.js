import express from 'express';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import cors from 'cors';
import router from './routes/authRoutes.js';
import chalk from 'chalk';
import cookieParser from 'cookie-parser';
import productRoutes from './routes/productRoutes.js';
import productionRoutes from './routes/productionRoutes.js';
import rawmaterialRoutes from './routes/rawmaterialRoutes.js';
import producttypeRoutes from './routes/producttypeRoutes.js';
import packingRoutes from './routes/packingRoutes.js';
import parameterRoutes from './routes/parameterRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';

// Load env variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();

// Middlewaremm
// app.use(cors());
app.use(express.json());

// Use CORS middleware to allow requests from the frontend
console.log(chalk.green("CLIENT_URL ***** : ",process.env.CLIENT_URL));
app.use(cors({
  origin: process.env.CLIENT_URL, // Allow frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(cookieParser());

// Basic test route in server.js
app.get('/', (req, res) => {
  res.send('Backend server is running');
});

// Use routes
app.use(router); // This makes the route http://localhost:5000/api/send-contact-email
app.use('/api/products', productRoutes);
app.use('/api', productionRoutes);
app.use('/api/raw', rawmaterialRoutes);
app.use('/api/product-type', producttypeRoutes);
app.use('/api/packings', packingRoutes);
app.use('/api/', parameterRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/campaigns', campaignRoutes);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(chalk.green(`🚀 Server running on http://localhost:${PORT}`));
});