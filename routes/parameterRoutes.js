
import express from 'express';
import {
  getDensityOptions,
  getAllTemperature,
  getAllDimension,
  getAllParameterOptions,
  createDensity,
  updateDensity,
  createTemperature,
  updateTemperature,
  createDimension,
  getDensityOptionsById,
  getTemperatureOptionsById,
  getDimensionOptionsById,
  getDensitys,
  UpdateDimension,
  deleteDensity,
  deleteTemperature,
  deleteDimension,
} from '../controllers/parameterController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(auth);
// Grouped endpoint: fetch all four parameter option lists
// GET /api/options
router.get('/options', roleAuth('parameters:read'), getAllParameterOptions);

// Individual endpoints
// GET /api/densities
router.get('/densities',roleAuth('parameters:densities:read'), getDensitys);
router.get('/densities/by-id',roleAuth('parameters:densities:read'), getDensityOptionsById);
router.post('/densities', roleAuth('parameters:densities:create'), createDensity);
router.put('/densities/:id', roleAuth('parameters:densities:update'), updateDensity);
router.delete('/densities/:id', roleAuth('parameters:densities:delete'), deleteDensity);
// router.get('/densitiesOptions',roleAuth('parameters:densities:read'), getDensityOptions);

// GET /api/temperatures
router.get('/temperatures',roleAuth('parameters:temperatures:read'), getAllTemperature);
router.get('/temperatures/by-id',roleAuth('parameters:temperatures:read'), getTemperatureOptionsById);
router.post('/temperatures', roleAuth('parameters:temperatures:create'), createTemperature);
router.put('/temperatures/:id', roleAuth('parameters:temperatures:update'), updateTemperature);
router.delete('/temperatures/:id', roleAuth('parameters:temperatures:delete'), deleteTemperature);

// GET /api/dimensions
router.get('/dimensions',roleAuth('parameters:dimensions:read'), getAllDimension);
router.get('/dimensions/by-id',roleAuth('parameters:dimensions:read'), getDimensionOptionsById);
router.post('/dimensions', roleAuth('parameters:dimensions:create'), createDimension);
router.put('/dimensions', roleAuth('parameters:dimensions:update'), UpdateDimension);
router.put('/dimensions/:id', roleAuth('parameters:dimensions:update'), UpdateDimension);
router.delete('/dimensions/:id', roleAuth('parameters:dimensions:delete'), deleteDimension);

// CREATE endpoints



export default router;
