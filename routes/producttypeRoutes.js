import express from 'express';
const router = express.Router();
import * as productTypeController from '../controllers/productTypeController.js';
import verifyAccessToken from '../middleware/authMiddleware.js';

// Create a new product type
router.post('/', verifyAccessToken, productTypeController.createProductType);

// Get all product types
router.get('/', verifyAccessToken, productTypeController.getProductTypes);

// Get a single product type by ID
router.get('/:id', verifyAccessToken, productTypeController.getProductTypeById);

// Update a product type by ID
router.put('/:id', verifyAccessToken, productTypeController.updateProductType);

// Delete a product type by ID
router.delete('/:id', verifyAccessToken, productTypeController.deleteProductType);

export default router;