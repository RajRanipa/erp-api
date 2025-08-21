// routes/productionRoutes.js
import express from 'express';
import { createWorkOrder, getAllWorkOrders,updateWorkOrder, rePackProduct, getAllRePackingLogs, getAllInventory } from '../controllers/productionController.js'; // Assuming the controller is here

const router = express.Router();

router.post('/work-orders', createWorkOrder);
router.get('/work-orders', getAllWorkOrders);
router.put('/work-orders/:id', updateWorkOrder);
// New route for re-packing products
router.post('/repack', rePackProduct);
// New route for fetching all re-packing logs
router.get('/repack-logs', getAllRePackingLogs);
// New route for fetching all inventory items
router.get('/inventory', getAllInventory);
export default router;