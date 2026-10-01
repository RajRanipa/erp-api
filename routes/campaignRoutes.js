

import express from 'express';
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  validateCampaign,
  activeCampaigns,
  campaignOverview,
  campaignProductionReport,
  campaignProductionRecords,
} from '../controllers/campaignController.js';
import auth, { roleAuth } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(auth);
// GET /api/campaigns
router.get('/active', roleAuth('campaigns:read'), activeCampaigns);

router.get('/overview', roleAuth('campaigns:read'), campaignOverview);

router.get('/', roleAuth('campaigns:read'), listCampaigns);

router.get(
  '/:id/production-report',
  roleAuth('campaigns:read', 'production:read'),
  campaignProductionReport,
);

router.get(
  '/:id/production-records',
  roleAuth('campaigns:read', 'production:read'),
  campaignProductionRecords,
);

// GET /api/campaigns/:id
router.get('/:id', roleAuth('campaigns:read'), getCampaignById);

// POST /api/campaigns
router.post('/', roleAuth('campaigns:create'), validateCampaign, createCampaign);

// PUT /api/campaigns/:id
router.put('/:id', roleAuth('campaigns:update'), validateCampaign, updateCampaign);

// DELETE /api/campaigns/:id
router.delete('/:id', roleAuth('campaigns:delete'), deleteCampaign);

export default router;
