import express from 'express';
import auth, { roleAuth } from '../middleware/authMiddleware.js';
import {
  acceptInvite,
  createInvite,
  declineInviteByToken,
  listInvites,
  listUserAudit,
  listUsers,
  meUser,
  removeUser,
  resendInvite,
  restoreUser,
  revokeInvite,
  updateMyPreferences,
  updateMyProfile,
  updateUserRole,
  validateInvite,
} from '../controllers/usersController.js';
import { authRateLimit } from '../middleware/rateLimitMiddleware.js';

const inviteRoutes = express.Router();
inviteRoutes.use(auth);
inviteRoutes.get('/me', meUser);
inviteRoutes.get('/audit', roleAuth('users:read'), listUserAudit);
inviteRoutes.get('/invite', roleAuth('users:invite:read'), listInvites);
inviteRoutes.post('/invite', roleAuth('users:invite:create'), createInvite);
inviteRoutes.post('/invite/:id/resend', roleAuth('users:invite:resend'), resendInvite);
inviteRoutes.post('/invite/:id/revoke', roleAuth('users:invite:revoke'), revokeInvite);
inviteRoutes.patch('/:id/role', roleAuth('users:update:role'), updateUserRole);
inviteRoutes.post('/:id/restore', roleAuth('users:restore'), restoreUser);
inviteRoutes.delete('/:id', roleAuth('users:remove'), removeUser);
inviteRoutes.get('/', roleAuth('users:read'), listUsers);

const inviteAuthRoutes = express.Router();
inviteAuthRoutes.get('/auth/invite/validate', authRateLimit, validateInvite);
inviteAuthRoutes.post('/auth/accept-invite', authRateLimit, acceptInvite);
inviteAuthRoutes.post('/auth/decline-invite', authRateLimit, declineInviteByToken);

const settingRoutes = express.Router();
settingRoutes.use(auth);
settingRoutes.put('/profile', updateMyProfile);
settingRoutes.put('/preferences', updateMyPreferences);

export { inviteRoutes, inviteAuthRoutes, settingRoutes };
export default { inviteRoutes, inviteAuthRoutes, settingRoutes };
