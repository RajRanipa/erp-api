import express from 'express';
import {
  createInventoryConversion,
  createBlanketPacking,
  createInventoryIssue,
  createInventoryReceipt,
  createOpeningStockAdjustment,
  createInventoryTransfer,
  getInventoryStock,
  getInventorySummary,
  getInventoryReceiptContext,
  getInventorySerials,
  getInventoryTransactions,
  rejectInventoryLot,
} from '../controllers/inventoryController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/summary', roleAuth('inventory:read'), getInventorySummary);
router.get('/receipt-context', roleAuth('inventory:receipt'), getInventoryReceiptContext);
router.get('/stock', roleAuth('inventory:read'), getInventoryStock);
router.get('/transactions', roleAuth('inventory:read'), getInventoryTransactions);
router.get('/serials', roleAuth('inventory:read'), getInventorySerials);
router.post('/receipts', roleAuth('inventory:receipt'), createInventoryReceipt);
router.post(
  '/opening-stock-adjustments',
  roleAuth('inventory:adjust'),
  createOpeningStockAdjustment,
);
router.post('/issues', roleAuth('inventory:issue'), createInventoryIssue);
router.post('/transfers', roleAuth('inventory:transfer'), createInventoryTransfer);
router.post('/conversions', roleAuth('inventory:repack'), createInventoryConversion);
router.post('/blanket-packings', roleAuth('inventory:repack'), createBlanketPacking);
router.post('/lots/:id/reject', roleAuth('inventory:adjust'), rejectInventoryLot);

export default router;
