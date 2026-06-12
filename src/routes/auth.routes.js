const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Public
router.post('/register', ctrl.register);
router.post('/verify-otp', ctrl.verifyOtp);
router.post('/resend-otp', ctrl.resendOtp);
router.post('/login', ctrl.login);
router.post('/refresh-token', ctrl.refreshToken);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/verify-reset-otp', ctrl.verifyResetOtp);
router.post('/reset-password', ctrl.resetPassword);

// Protected
router.post('/logout', authenticate, ctrl.logout);
router.get('/me', authenticate, ctrl.getMe);
router.patch('/me', authenticate, ctrl.updateMe);
router.patch('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
