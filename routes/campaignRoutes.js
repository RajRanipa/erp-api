

import express from 'express';
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  validateCampaign
} from '../controllers/campaignController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(auth);
// GET /api/campaigns
router.get('/', roleAuth('campaigns:read'), listCampaigns);

// GET /api/campaigns/:id
router.get('/:id', roleAuth('campaigns:read'), getCampaignById);

// POST /api/campaigns
router.post('/', roleAuth('campaigns:create'), validateCampaign, createCampaign);

// PUT /api/campaigns/:id
router.put('/:id', roleAuth('campaigns:update'), validateCampaign, updateCampaign);

// DELETE /api/campaigns/:id
router.delete('/:id', roleAuth('campaigns:delete'), deleteCampaign);

export default router;