
import express from 'express';
import {
  getDensityOptions,
  getTemperatureOptions,
  getDimensionOptions,
  getAllParameterOptions,
  createDensity,
  createTemperature,
  createDimension,
  getDensityOptionsById,
  getTemperatureOptionsById,
  getDimensionOptionsById,

} from '../controllers/parameterController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(auth);
// Grouped endpoint: fetch all four parameter option lists
// GET /api/options
router.get('/options', roleAuth('parameters:read'), getAllParameterOptions);

// Individual endpoints
// GET /api/densities
router.get('/densities',roleAuth('parameters:read'), getDensityOptions);
router.get('/densities/by-id',roleAuth('parameters:read'), getDensityOptionsById);

// GET /api/temperatures
router.get('/temperatures',roleAuth('parameters:read'), getTemperatureOptions);
router.get('/temperatures/by-id',roleAuth('parameters:read'), getTemperatureOptionsById);

// GET /api/dimensions
router.get('/dimensions',roleAuth('parameters:read'), getDimensionOptions);
router.get('/dimensions/by-id',roleAuth('parameters:read'), getDimensionOptionsById);

// CREATE endpoints
router.post('/densities', roleAuth('parameters:create'), createDensity);
router.post('/temperatures', roleAuth('parameters:create'), createTemperature);
router.post('/dimensions', roleAuth('parameters:create'), createDimension);

export default router;
