// routes/rawmaterialRoutes.js
import express from 'express';
import { createBatch, listBatches, getBatchById, updateBatch, deleteBatch, addRawMaterial, removeRawMaterial } from '../controllers/batchesController.js'; // Assuming the controller is here
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
router.post('/:id/raw-materials', roleAuth('batches:update'), addRawMaterial);             // POST   /api/batches/:id/raw-materials
router.delete('/:id/raw-materials/:rmId', roleAuth('batches:delete'), removeRawMaterial);  // DELETE /api/batches/:id/raw-materials/:rmId

export default router;