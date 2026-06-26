import express from 'express';
const router = express.Router();
import * as productTypeController from '../controllers/productTypeController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

router.use(auth);
// Create a new product type
router.post('/', roleAuth('parameters:producttypes:create'), productTypeController.createProductType);

// Get all product types
router.get('/', roleAuth('parameters:producttypes:read'), productTypeController.getProductTypes);

// Get all product types for option
router.get('/options', roleAuth('parameters:producttypes:read'), productTypeController.getProductTypesOptions);

// Get a single product type by ID
router.get('/:id', roleAuth('parameters:producttypes:read'), productTypeController.getProductTypeById);

// Update a product type by ID
router.put('/', roleAuth('parameters:producttypes:update'), productTypeController.updateProductType);

// Delete a product type by ID
router.delete('/:id', roleAuth('parameters:producttypes:delete'), productTypeController.deleteProductType);

export default router;