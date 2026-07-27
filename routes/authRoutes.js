import express from 'express';
import * as Auth from '../controllers/authController.js';
import auth from '../middleware/authMiddleware.js';
import { authRateLimit, otpRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.get('/checkAuth', auth, Auth.checkAuth);

router.post('/signup/start', otpRateLimit, Auth.signupStart);
router.post('/signup/verify-otp', otpRateLimit, Auth.signupVerifyOtp);
router.post('/signup/resend-otp', otpRateLimit, Auth.signupResendOtp);
router.post('/signup', authRateLimit, Auth.signup);

router.post('/login', authRateLimit, Auth.login);
router.post('/login/start-otp', otpRateLimit, Auth.loginStartOtp);
router.post('/login/verify-otp', otpRateLimit, Auth.loginVerifyOtp);
router.post('/login/resend-otp', otpRateLimit, Auth.loginResendOtp);
router.post('/refresh-token', authRateLimit, Auth.refreshToken);

router.post('/password-reset/start', otpRateLimit, Auth.passwordResetStart);
router.post('/password-reset/complete', otpRateLimit, Auth.passwordResetComplete);

router.post('/logout', Auth.logout);
router.post('/logout-all', auth, Auth.logoutAll);
router.post('/change-password', auth, Auth.changePassword);
router.post('/change-email/start', auth, otpRateLimit, Auth.emailChangeStart);
router.post('/change-email/verify', auth, otpRateLimit, Auth.emailChangeVerify);
router.get('/sessions', auth, Auth.listSessions);
router.delete('/sessions/:sessionId', auth, Auth.revokeSession);
router.get('/companies', auth, Auth.listMyCompanies);
router.post('/switch-company', auth, Auth.switchCompany);

export default router;
