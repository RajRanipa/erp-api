// routes/rawmaterialRoutes.js
import express from 'express';
import { getAllRawMaterialsOptions,getAllRawMaterials, getRawMaterialById , createRawMaterial, updateRawMaterial, deleteRawMaterial } from '../controllers/rawmaterialController.js'; // Assuming the controller is here
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/', roleAuth('rawmaterials:read'), getAllRawMaterialsOptions);
router.get('/all', roleAuth('rawmterials:read'), getAllRawMaterials);
router.get('/:id', roleAuth('rawmterials:read'), getRawMaterialById);
router.post('/create', roleAuth('rawmterials:create'), createRawMaterial);
router.put('/:id', roleAuth('rawmterials:update'), updateRawMaterial);
router.delete('/:id', roleAuth('rawmterials:delete'), deleteRawMaterial);

export default router;