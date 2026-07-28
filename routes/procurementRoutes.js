import express from 'express';
import {
  approveInvoice,
  approveOrder,
  cancelInvoice,
  cancelOrder,
  cancelReceipt,
  cancelReturn,
  closeOrder,
  createInvoice,
  createOrder,
  createReceipt,
  createReturn,
  getGoodsReceipt,
  getProcurementLookups,
  getProcurementSummary,
  getPurchaseInvoice,
  getPurchaseOrder,
  getPurchaseReturn,
  listGoodsReceipts,
  listPurchaseInvoices,
  listPurchaseOrders,
  listPurchaseReturns,
  markInvoicePaid,
  postReceipt,
  postReturn,
  rejectOrder,
  resolveReceiptInspection,
  submitOrder,
  updateOrder,
  updateInvoice,
  updateReceipt,
  updateReturn,
  verifyInvoice,
} from '../controllers/procurementController.js';
import verifyAccessToken, { roleAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/apiMiddleware.js';

const router = express.Router();

router.use(verifyAccessToken);

router.get('/summary', roleAuth('procurement:read'), asyncHandler(getProcurementSummary));
router.get('/lookups/:type', roleAuth('procurement:read'), asyncHandler(getProcurementLookups));

router.get('/orders', roleAuth('procurement:read'), asyncHandler(listPurchaseOrders));
router.post('/orders', roleAuth('procurement:create'), asyncHandler(createOrder));
router.get('/orders/:id', roleAuth('procurement:read'), asyncHandler(getPurchaseOrder));
router.patch('/orders/:id', roleAuth('procurement:update'), asyncHandler(updateOrder));
router.post('/orders/:id/submit', roleAuth('procurement:submit'), asyncHandler(submitOrder));
router.post('/orders/:id/approve', roleAuth('procurement:approve'), asyncHandler(approveOrder));
router.post('/orders/:id/reject', roleAuth('procurement:approve'), asyncHandler(rejectOrder));
router.post('/orders/:id/close', roleAuth('procurement:approve'), asyncHandler(closeOrder));
router.post('/orders/:id/cancel', roleAuth('procurement:cancel'), asyncHandler(cancelOrder));

router.get('/receipts', roleAuth('procurement:read'), asyncHandler(listGoodsReceipts));
router.post('/receipts', roleAuth('procurement:receive'), asyncHandler(createReceipt));
router.get('/receipts/:id', roleAuth('procurement:read'), asyncHandler(getGoodsReceipt));
router.patch('/receipts/:id', roleAuth('procurement:receive'), asyncHandler(updateReceipt));
router.post('/receipts/:id/post', roleAuth('procurement:receive'), asyncHandler(postReceipt));
router.post('/receipts/:id/resolve-inspection', roleAuth('procurement:receive'), asyncHandler(resolveReceiptInspection));
router.post('/receipts/:id/cancel', roleAuth('procurement:cancel'), asyncHandler(cancelReceipt));

router.get('/returns', roleAuth('procurement:read'), asyncHandler(listPurchaseReturns));
router.post('/returns', roleAuth('procurement:return'), asyncHandler(createReturn));
router.get('/returns/:id', roleAuth('procurement:read'), asyncHandler(getPurchaseReturn));
router.patch('/returns/:id', roleAuth('procurement:return'), asyncHandler(updateReturn));
router.post('/returns/:id/post', roleAuth('procurement:return'), asyncHandler(postReturn));
router.post('/returns/:id/cancel', roleAuth('procurement:cancel'), asyncHandler(cancelReturn));

router.get('/invoices', roleAuth('procurement:read'), asyncHandler(listPurchaseInvoices));
router.post('/invoices', roleAuth('procurement:invoice'), asyncHandler(createInvoice));
router.get('/invoices/:id', roleAuth('procurement:read'), asyncHandler(getPurchaseInvoice));
router.patch('/invoices/:id', roleAuth('procurement:invoice'), asyncHandler(updateInvoice));
router.post('/invoices/:id/verify', roleAuth('procurement:invoice'), asyncHandler(verifyInvoice));
router.post('/invoices/:id/approve', roleAuth('procurement:approve'), asyncHandler(approveInvoice));
router.post('/invoices/:id/paid', roleAuth('procurement:invoice'), asyncHandler(markInvoicePaid));
router.post('/invoices/:id/cancel', roleAuth('procurement:cancel'), asyncHandler(cancelInvoice));

export default router;
