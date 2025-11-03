// backend-api/routes/companyRoutes.js
import express from 'express';
import {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  getCompanyMe,
  finishCompany
} from '../controllers/companyController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();


// POST create
router.post('/', roleAuth('companies:create'), createCompany);

router.post('/finish', roleAuth('companies:full'), finishCompany);

// get current user
router.get('/me', roleAuth('companies:read'), getCompanyMe);

// GET current user scoped list
router.get('/', roleAuth('companies:read'), getCompanies);

// GET one
router.get('/:id', roleAuth('companies:read'), getCompanyById);

// PATCH update
router.patch('/', roleAuth('companies:update'), updateCompany);

// DELETE
router.delete('/:id', roleAuth('companies:delete'), deleteCompany);


export default router;