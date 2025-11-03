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
import auth from '../middleware/authMiddleware.js';
const router = express.Router();

// router.get('/', auth, authorizeRoles('admin'), getProducts);
router.get('/', auth, getProducts);
router.get('/names', auth, getUniqueProductNames);
router.get('/dimensions', auth, getUniqueDimensions);
router.get('/densities', auth, getUniqueDensities);
router.get('/temperatures', auth, getUniqueTemperatures);
// router.get('/packings', auth, getUniquePackings);
router.post('/create', auth, createProduct);
router.put('/:id', auth, updateProduct);
router.delete('/:id', auth, deleteProduct);

export default router;