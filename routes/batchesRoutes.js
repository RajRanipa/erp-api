import express from 'express';
import {
  createBatch,
  listBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
  addBatchMaterial,
  removeBatchMaterial,
} from '../controllers/batchesController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
// Batches CRUD
router.use(auth);
router.post('/', roleAuth('batches:create'), createBatch);           // CREATE  -> POST   /api/batches
router.get('/', roleAuth('batches:read'), listBatches);            // LIST    -> GET    /api/batches?page=&limit=&q=&from=&to=&createdBy=
router.get('/:id', roleAuth('batches:read'), getBatchById);        // READ    -> GET    /api/batches/:id
router.patch('/:id', roleAuth('batches:update'), updateBatch);       // UPDATE  -> PATCH  /api/batches/:id  (or use .put if you prefer full replace)
router.delete('/:id', roleAuth('batches:delete'), deleteBatch);      // DELETE  -> DELETE /api/batches/:id

// Raw materials inside a batch
router.post('/:id/raw-materials', roleAuth('batches:update'), addBatchMaterial);
router.delete('/:id/raw-materials/:materialId', roleAuth('batches:delete'), removeBatchMaterial);

export default router;
