import express from 'express';
import {
  getAllProduction,
  getProductionReportDay,
  getProductionReportNight,
  sentProductionReport,
} from '../controllers/productionController.js';
import Auth, { roleAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/apiMiddleware.js';

const router = express.Router();
router.use(Auth);
router.get('/', roleAuth('production:read'), asyncHandler(getAllProduction));
router.get('/day', roleAuth('production:read'), asyncHandler(getProductionReportDay));
router.get('/night', roleAuth('production:read'), asyncHandler(getProductionReportNight));
router.post('/send-report', roleAuth('production:read'), asyncHandler(sentProductionReport));

export default router;
