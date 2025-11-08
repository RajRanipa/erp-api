// routes/warehouseRoutes.js
import { Router } from 'express';
import {
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  deleteWarehouse,
} from '../controllers/WarehouseController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const r = Router();
r.post('/', auth, roleAuth('warehouses:create'),  createWarehouse);
r.get('/', auth, roleAuth('warehouses:read'), listWarehouses);
r.get('/:id', auth, roleAuth('warehouses:read'), getWarehouse);
r.put('/:id', auth, roleAuth('warehouses:update'), updateWarehouse);
r.delete('/:id', auth, roleAuth('warehouses:delete'), deleteWarehouse);

export default r;