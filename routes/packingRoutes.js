
import express from 'express';
import * as packingController from '../controllers/packingController.js';
const router = express.Router();

// Create a new packing
router.post('/create', packingController.createPacking);

// Get all packing
router.get('/', packingController.getAllPacking);

// Get a packing by ID
router.get('/by-id', packingController.getPackingById);

// Update a packing by ID
router.put('/:id', packingController.updatePacking);

// Delete a packing by ID
router.delete('/:id', packingController.deletePacking);

export default router;