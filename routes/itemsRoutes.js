import express from 'express';
import {
  createItem,
  getItemById,
  getAllItems,
  getAllItemsOptions,
  updateItem,
  deleteItem,
  getPackingItems,
  getRawItems,
  getFinishedItems,
  getPackingItemsByid
} from '../controllers/itemsController.js'; 
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/packings', roleAuth('items:read'), getPackingItems);
router.get('/finished', roleAuth('items:full'), getFinishedItems);
router.get('/raw', roleAuth('items:read'), getRawItems);
router.get('/packings/by-id', roleAuth('items:read'), getPackingItemsByid);

router.get('/by-id', roleAuth('items:read'),  getItemById); 
router.post('/', roleAuth('items:create'),  createItem);
router.get('/', roleAuth('items:read'),  getAllItems);
router.get('/options', roleAuth('items:read'),  getAllItemsOptions);
router.put('/:id', roleAuth('items:update'),  updateItem);
router.delete('/:id', roleAuth('items:delete'),  deleteItem);

export default router;