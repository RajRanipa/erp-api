import express from 'express';
import {
  createParty,
  listParties,
  getPartyById,
  updateParty,
  patchPartyStatus,
  deleteParty,
} from '../controllers/PartyController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(auth);
router.post('/', roleAuth('parties:create'), createParty);
router.get('/', roleAuth('parties:read'), listParties);
router.get('/:id', roleAuth('parties:read'), getPartyById);
router.put('/:id', roleAuth('parties:update'), updateParty);
router.patch('/:id/status', roleAuth('parties:update'), patchPartyStatus);
router.delete('/:id', roleAuth('parties:delete'), deleteParty);

export default router;
