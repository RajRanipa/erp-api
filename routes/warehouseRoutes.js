// routes/warehouseRoutes.js
import { Router } from 'express';
import {
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  deleteWarehouse,
} from '../controllers/WarehouseController.js';
import auth from '../middleware/authMiddleware.js';

const r = Router();
r.post('/', auth,  createWarehouse);
r.get('/', auth,  listWarehouses);
r.get('/:id', auth,  getWarehouse);
r.put('/:id', auth,  updateWarehouse);
r.delete('/:id', auth,  deleteWarehouse);

export default r;