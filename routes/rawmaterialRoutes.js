// routes/rawmaterialRoutes.js
import express from 'express';
import { getAllRawMaterials, getRawMaterialById , createRawMaterial, updateRawMaterial, deleteRawMaterial } from '../controllers/rawmaterialController.js'; // Assuming the controller is here
import verifyAccessToken from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', verifyAccessToken, getAllRawMaterials);
router.get('/:id', verifyAccessToken, getRawMaterialById);
router.post('/create', verifyAccessToken, createRawMaterial);
router.put('/:id', verifyAccessToken, updateRawMaterial);
router.delete('/:id', verifyAccessToken, deleteRawMaterial);

export default router;