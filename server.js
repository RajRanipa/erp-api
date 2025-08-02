import express from 'express';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import cors from 'cors';
import router from './routes/authRoutes.js';
import chalk from 'chalk';
import cookieParser from 'cookie-parser';


// Load env variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();

// Middleware
// app.use(cors());
app.use(express.json());
app.use(cookieParser());


// Use CORS middleware to allow requests from the frontend
app.use(cors({
  origin: 'http://localhost:3000', // Allow frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// Basic test route in server.js
app.get('/', (req, res) => {
  res.send('Backend server is running');
});

// Use routes
app.use(router); // This makes the route http://localhost:5000/api/send-contact-email

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(chalk.green(`🚀 Server running on http://localhost:${PORT}`));
});