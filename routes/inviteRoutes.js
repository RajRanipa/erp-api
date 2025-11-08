// routes/inviteRoutes.js
import express from 'express';
import auth, { roleAuth } from '../middleware/authMiddleware.js';
import { createInvite, resendInvite, revokeInvite, validateInvite, acceptInvite, listInvites, declineInviteByToken } from '../controllers/inviteController.js';

const router = express.Router();
const router2 = express.Router();

router.post('/invite', auth, roleAuth('users:invite'), createInvite);
router.post('/invite/:id/resend', auth, roleAuth('users:invite'), resendInvite);
router.post('/invite/:id/revoke', auth, roleAuth('users:invite'), revokeInvite);
// list invites (company-scoped) with optional ?status=pending|accepted|revoked
router.get('/invite', auth, roleAuth('users:invite'), listInvites);

// public
router2.get('/auth/invite/validate', validateInvite);
router2.post('/auth/accept-invite', acceptInvite);
router2.post('/auth/decline-invite', declineInviteByToken);
// "/auth/decline-invite"
export const inviteRoutes = router;
export const inviteAuthRoutes = router2;
export default { inviteRoutes, inviteAuthRoutes };