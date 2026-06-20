
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
router.get('/densities',roleAuth('parameters:densities:read'), getDensityOptions);
router.get('/densities/by-id',roleAuth('parameters:densities:read'), getDensityOptionsById);

// GET /api/temperatures
router.get('/temperatures',roleAuth('parameters:temperatures:read'), getTemperatureOptions);
router.get('/temperatures/by-id',roleAuth('parameters:temperatures:read'), getTemperatureOptionsById);

// GET /api/dimensions
router.get('/dimensions',roleAuth('parameters:dimensions:read'), getDimensionOptions);
router.get('/dimensions/by-id',roleAuth('parameters:dimensions:read'), getDimensionOptionsById);

// CREATE endpoints
router.post('/densities', roleAuth('parameters:temperatures:create'), createDensity);
router.post('/temperatures', roleAuth('parameters:temperatures:create'), createTemperature);
router.post('/dimensions', roleAuth('parameters:dimensions:create'), createDimension);

export default router;
