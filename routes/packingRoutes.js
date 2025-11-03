
import express from 'express';
import * as packingController from '../controllers/packingController.js';
const router = express.Router();
import auth, { roleAuth } from '../middleware/authMiddleware.js';

router.use(auth);
// Create a new packing
router.post('/create', roleAuth('packings:create'), packingController.createPacking);

// Get all packing
router.get('/',roleAuth('packings:read'), packingController.getAllPacking);

// Get a packing by ID
router.get('/by-id',roleAuth('packings:read'), packingController.getPackingById);

// Update a packing by ID
router.put('/:id',roleAuth('packings:update'), packingController.updatePacking);

// Delete a packing by ID
router.delete('/:id',roleAuth('packings:delete'), packingController.deletePacking);

export default router;