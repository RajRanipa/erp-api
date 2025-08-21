

import express from 'express';
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
} from '../controllers/campaignController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/campaigns
router.get('/', auth, listCampaigns);

// GET /api/campaigns/:id
router.get('/:id', auth, getCampaignById);

// POST /api/campaigns
router.post('/', auth, createCampaign);

// PUT /api/campaigns/:id
router.put('/:id', auth, updateCampaign);

// DELETE /api/campaigns/:id
router.delete('/:id', auth, deleteCampaign);

export default router;