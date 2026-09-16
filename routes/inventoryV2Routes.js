import express from 'express';
import {
  createInventoryV2Conversion,
  createBlanketPacking,
  createInventoryV2Issue,
  createInventoryV2Receipt,
  createInventoryV2Transfer,
  getInventoryV2Stock,
  getInventoryV2Summary,
  getInventoryReceiptContext,
  getInventoryV2Serials,
  getInventoryV2Transactions,
  rejectInventoryLot,
} from '../controllers/inventoryV2Controller.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/summary', roleAuth('inventory:read'), getInventoryV2Summary);
router.get('/receipt-context', roleAuth('inventory:receipt'), getInventoryReceiptContext);
router.get('/stock', roleAuth('inventory:read'), getInventoryV2Stock);
router.get('/transactions', roleAuth('inventory:read'), getInventoryV2Transactions);
router.get('/serials', roleAuth('inventory:read'), getInventoryV2Serials);
router.post('/receipts', roleAuth('inventory:receipt'), createInventoryV2Receipt);
router.post('/issues', roleAuth('inventory:issue'), createInventoryV2Issue);
router.post('/transfers', roleAuth('inventory:transfer'), createInventoryV2Transfer);
router.post('/conversions', roleAuth('inventory:repack'), createInventoryV2Conversion);
router.post('/blanket-packings', roleAuth('inventory:repack'), createBlanketPacking);
router.post('/lots/:id/reject', roleAuth('inventory:adjust'), rejectInventoryLot);

export default router;
