import express from 'express';
const router = express.Router();
import * as productTypeController from '../controllers/productTypeController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

router.use(auth);
// Create a new product type
router.post('/', roleAuth('producttypes:create'), productTypeController.createProductType);

// Get all product types
router.get('/', roleAuth('producttypes:read'), productTypeController.getProductTypes);

// Get a single product type by ID
router.get('/:id', roleAuth('producttypes:read'), productTypeController.getProductTypeById);

// Update a product type by ID
router.put('/:id', roleAuth('producttypes:update'), productTypeController.updateProductType);

// Delete a product type by ID
router.delete('/:id', roleAuth('producttypes:delete'), productTypeController.deleteProductType);

export default router;