import express from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getUniqueProductNames,
  getUniqueDimensions,
  getUniqueDensities,
  getUniqueTemperatures,
  getUniquePackings
} from '../controllers/productController.js';
import verifyAccessToken from '../middleware/authMiddleware.js';
const router = express.Router();

// router.get('/', verifyAccessToken, authorizeRoles('admin'), getProducts);
router.get('/', verifyAccessToken, getProducts);
router.get('/names', verifyAccessToken, getUniqueProductNames);
router.get('/dimensions', verifyAccessToken, getUniqueDimensions);
router.get('/densities', verifyAccessToken, getUniqueDensities);
router.get('/temperatures', verifyAccessToken, getUniqueTemperatures);
router.get('/packings', verifyAccessToken, getUniquePackings);
router.post('/create', verifyAccessToken, createProduct);
router.put('/:id', verifyAccessToken, updateProduct);
router.delete('/:id', verifyAccessToken, deleteProduct);

export default router;