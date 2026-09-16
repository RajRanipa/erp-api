import express from 'express';
import {
  activateManufacturingRecipe,
  advanceBoardStage,
  createBoardDraw,
  createChoppingBatch,
  createManufacturingOrder,
  createManufacturingRecipe,
  getManufacturingOrder,
  getManufacturingOrders,
  getManufacturingRecipes,
  packBoard,
  recordBoardInspection,
  releaseManufacturingOrder,
} from '../controllers/manufacturingV2Controller.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.get('/recipes', roleAuth('production:read'), getManufacturingRecipes);
router.post('/recipes', roleAuth('production:create'), createManufacturingRecipe);
router.patch('/recipes/:id/activate', roleAuth('production:update'), activateManufacturingRecipe);
router.get('/orders', roleAuth('production:read'), getManufacturingOrders);
router.post('/orders', roleAuth('production:create'), createManufacturingOrder);
router.get('/orders/:id', roleAuth('production:read'), getManufacturingOrder);
router.post('/orders/:id/release', roleAuth('production:update'), releaseManufacturingOrder);
router.post('/orders/:id/board/draw', roleAuth('production:update'), createBoardDraw);
router.post('/orders/:id/board/advance', roleAuth('production:update'), advanceBoardStage);
router.post('/orders/:id/board/inspect', roleAuth('production:update'), recordBoardInspection);
router.post('/orders/:id/board/pack', roleAuth('production:update'), packBoard);
router.post('/chopping-batches', roleAuth('production:create'), createChoppingBatch);

export default router;
