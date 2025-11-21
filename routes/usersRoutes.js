// routes/inviteRoutes.js
import express from 'express';
import auth, { roleAuth } from '../middleware/authMiddleware.js';
import {
    createInvite,
    resendInvite,
    revokeInvite,
    validateInvite,
    acceptInvite,
    listInvites,
    listUsers,
    declineInviteByToken,
    removeUser,
    updateUserRole,
    meUser,
    updateMyProfile,
    updateMyPreferences,
}
    from '../controllers/usersController.js';

const router = express.Router();
const router2 = express.Router();
const router3 = express.Router();

router.post('/invite', auth, roleAuth('users:invite:create'), createInvite);
router.post('/invite/:id/resend', auth, roleAuth('users:invite:resend'), resendInvite);
router.post('/invite/:id/revoke', auth, roleAuth('users:invite:revoke'), revokeInvite);
// remove user
router.delete('/:id', auth, roleAuth('users:remove'), removeUser);
router.get('/invite', auth, roleAuth('users:invite:read'), listInvites);

router.get('/', auth, roleAuth('users:read'), listUsers);
router.get('/me/:id', auth, roleAuth('users:read'), meUser);
router.patch('/:id/role', auth, roleAuth('users:update:role'), updateUserRole);

// public
router2.get('/auth/invite/validate', validateInvite);
router2.post('/auth/accept-invite', acceptInvite);
router2.post('/auth/decline-invite', declineInviteByToken);
// "/auth/decline-invite"

// private - setting my profile
router3.put('/profile', auth, updateMyProfile);
router3.put('/preferences', auth, updateMyPreferences);

export const inviteRoutes = router;
export const inviteAuthRoutes = router2;
export const settingRoutes = router3;
export default { inviteRoutes, inviteAuthRoutes, settingRoutes };
// /api/users/invite/690e01663d53431fd50a932b/revoke