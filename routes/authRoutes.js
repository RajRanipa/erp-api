import express from 'express';
import * as Auth from '../controllers/authController.js';
import protect from '../middleware/authMiddleware.js';
import auth from '../middleware/authMiddleware.js';
const router = express.Router();


// Check Authentication Status (Authenticated users)
router.get('/checkAuth', auth, Auth.checkAuth);
// Signup
router.post('/signup', Auth.signup);
router.post('/signup/start', Auth.signupStart);
router.post('/signup/verify-otp', Auth.signupVerifyOtp);
router.post('/signup/resend-otp', Auth.signupResendOtp);

// Login
router.post('/login', Auth.login);

// Logout (CLEAR JWT from cookies)
router.post('/logout', Auth.logout);
// NEW: login with OTP
router.post('/login/start-otp', Auth.loginStartOtp);
router.post('/login/verify-otp', Auth.loginVerifyOtp);
router.post('/login/resend-otp', Auth.loginResendOtp);

// Refresh Token
router.post('/refresh-token', Auth.refreshToken);



// const res = await axiosInstance.put('/change-theme');
router.put('/change-preferences', protect, Auth.changePreferences);

router.get('/api/test', (req, res) => {
  res.json({ message: 'Test route working added' });
});

// module.exports = router;
export default router;