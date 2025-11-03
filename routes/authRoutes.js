import express from 'express';
import * as Auth from '../controllers/authController.js';
import protect from '../middleware/authMiddleware.js';
import auth from '../middleware/authMiddleware.js';
const router = express.Router();


// Signup
router.post('/signup', Auth.signup);

// Login
router.post('/login', Auth.login);
// auth/me
router.post('/auth/me', Auth.login);

// Logout (CLEAR JWT from cookies)
router.post('/logout', Auth.logout);

// Refresh Token
router.post('/refresh-token', Auth.refreshToken);

// Check Authentication Status (Authenticated users)
router.get('/check-auth',auth, Auth.checkAuth);

// const res = await axiosInstance.put('/change-theme');
router.put('/change-preferences', protect, Auth.changePreferences);

router.get('/api/test', (req, res) => {
  res.json({ message: 'Test route working added' });
});

// module.exports = router;
export default router;