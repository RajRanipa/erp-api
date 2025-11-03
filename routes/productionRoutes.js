// routes/productionRoutes.js
import express from 'express';
import { createWorkOrder, getAllWorkOrders,updateWorkOrder, rePackProduct, getAllRePackingLogs, getAllInventory } from '../controllers/productionController.js'; // Assuming the controller is here
import Auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(Auth);
router.post('/work-orders',roleAuth('production:create'), createWorkOrder);
router.get('/work-orders', roleAuth('production:read'), getAllWorkOrders);
router.put('/work-orders/:id',roleAuth('production:update'), updateWorkOrder);
// New route for re-packing products
router.post('/repack',roleAuth('production:update'), rePackProduct);
// New route for fetching all re-packing logs
router.get('/repack-logs',roleAuth('production:read'), getAllRePackingLogs);
// New route for fetching all inventory items
router.get('/inventory',roleAuth('production:read'), getAllInventory);
export default router;