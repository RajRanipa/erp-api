// backend-api/routes/inventoryRoutes.js
import express from 'express';
import {
  getStock,
  getLedger,
  receive,
  issue,
  adjust,
  transfer,
  repack,
  reserve,
  release,
} from '../controllers/inventoryController.js';
import verifyAccessToken, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All inventory routes require authentication
router.use(verifyAccessToken);

// READ: stock snapshot & ledger
router.get('/stock',   roleAuth('inventory:read'), getStock);
router.get('/ledger',  roleAuth('inventory:read'), getLedger);

// WRITE: movements
router.post('/receipt',   roleAuth('inventory:receive'),  receive);
router.post('/issue',     roleAuth('inventory:issue'),    issue);
router.post('/adjust',    roleAuth('inventory:adjust'),   adjust);
router.post('/transfer',  roleAuth('inventory:transfer'), transfer);
// REPACK (Packing change between two item variants)
router.post('/repack', roleAuth('inventory:repack'), repack);

// RESERVATIONS (optional)
router.post('/reserve',   roleAuth('inventory:reserve'),  reserve);
router.post('/release',   roleAuth('inventory:reserve'),  release);

export default router;
