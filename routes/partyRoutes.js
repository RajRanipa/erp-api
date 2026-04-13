// backend-api/routes/partyRoutes.js
import express from 'express';
import multer from 'multer';

import verifyAccessToken, { roleAuth } from '../middleware/authMiddleware.js';

import {
  createParty,
  getPartyById,
  listParties,
  getPartyOptions,
  updateParty,
  updatePartyStatus,
  deleteParty,
  exportPartiesXlsx,
  importPartiesXlsx,
} from '../controllers/PartyController.js';

const router = express.Router();

// All party routes require authentication
router.use(verifyAccessToken);

// Multer (memory) for Excel import
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// READ: lists / dropdowns
router.get('/', roleAuth('parties:read'), listParties);
router.get('/options', roleAuth('parties:read'), getPartyOptions);

// BULK: export/import
router.get('/export/xlsx', roleAuth('parties:export'), exportPartiesXlsx);
router.post('/import/xlsx', roleAuth('parties:import'), upload.single('file'), importPartiesXlsx);

router.get('/:id', roleAuth('parties:read'), getPartyById);

// WRITE: create/update/delete
router.post('/', roleAuth('parties:write'), createParty);
router.patch('/:id', roleAuth('parties:write'), updateParty);
router.patch('/:id/status', roleAuth('parties:write'), updatePartyStatus);
router.delete('/:id', roleAuth('parties:write'), deleteParty);

export default router;
