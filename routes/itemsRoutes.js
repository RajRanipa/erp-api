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
  getPackingItemsByid,
  getItemUomById
} from '../controllers/itemsController.js'; 
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/packings', roleAuth('items:read'), getPackingItems);
router.get('/finished', roleAuth('items:read'), getFinishedItems);
router.get('/raw', roleAuth('items:read'), getRawItems);
router.get('/uom/:id', roleAuth('items:read'), getItemUomById);
//  GET http://localhost:1122/api/items/uom/6909c8b… 404 (Not Found)
router.get('/packings/by-id', roleAuth('items:read'), getPackingItemsByid);

router.get('/by-id', roleAuth('items:read'),  getItemById); 
router.post('/', roleAuth('items:create'),  createItem);
router.get('/', roleAuth('items:read'),  getAllItems);
router.get('/options', roleAuth('items:read'),  getAllItemsOptions);
router.put('/:id', roleAuth('items:update'),  updateItem);
router.put('/status/:id', roleAuth('items:status:update'),  updateItem);
router.delete('/:id', roleAuth('items:delete'),  deleteItem);

export default router;