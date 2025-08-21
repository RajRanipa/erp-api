
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

const router = express.Router();

// Grouped endpoint: fetch all four parameter option lists
// GET /api/options
router.get('/options', getAllParameterOptions);

// Individual endpoints
// GET /api/densities
router.get('/densities', getDensityOptions);
router.get('/densities/by-id', getDensityOptionsById);

// GET /api/temperatures
router.get('/temperatures', getTemperatureOptions);
router.get('/temperatures/by-id', getTemperatureOptionsById);

// GET /api/dimensions
router.get('/dimensions', getDimensionOptions);
router.get('/dimensions/by-id', getDimensionOptionsById);

// CREATE endpoints
router.post('/densities', createDensity);
router.post('/temperatures', createTemperature);
router.post('/dimensions', createDimension);

export default router;
