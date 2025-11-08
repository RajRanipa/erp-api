
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
router.get('/options', roleAuth('items:parameters:read'), getAllParameterOptions);

// Individual endpoints
// GET /api/densities
router.get('/densities',roleAuth('items:parameters:read'), getDensityOptions);
router.get('/densities/by-id',roleAuth('items:parameters:read'), getDensityOptionsById);

// GET /api/temperatures
router.get('/temperatures',roleAuth('items:parameters:read'), getTemperatureOptions);
router.get('/temperatures/by-id',roleAuth('items:parameters:read'), getTemperatureOptionsById);

// GET /api/dimensions
router.get('/dimensions',roleAuth('items:parameters:read'), getDimensionOptions);
router.get('/dimensions/by-id',roleAuth('items:parameters:read'), getDimensionOptionsById);

// CREATE endpoints
router.post('/densities', roleAuth('items:parameters:create'), createDensity);
router.post('/temperatures', roleAuth('items:parameters:create'), createTemperature);
router.post('/dimensions', roleAuth('items:parameters:create'), createDimension);

export default router;
