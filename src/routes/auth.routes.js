const router = require("express").Router();
const ctrl = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const rateLimit = require("express-rate-limit");

// 1. Strict limit for authentication & security actions
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per 15 mins
  message: {
    success: false,
    message: "Too many attempts. Please try again in 15 minutes.",
  },
});

// 2. Generous limit for session checks, token refreshes, and profile updates
const userProfileLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    message: "Too many profile requests. Please slow down.",
  },
});
// --- STRICT ROUTES (Login, Register, OTPs, Passwords) ---
router.post("/register", ctrl.register);
router.post("/verify-otp", ctrl.verifyOtp);
router.post("/resend-otp", ctrl.resendOtp);
router.post("/login", ctrl.login);
router.post("/forgot-password", ctrl.forgotPassword);
router.post("/verify-reset-otp", ctrl.verifyResetOtp);
router.post("/reset-password", ctrl.resetPassword);
router.patch("/change-password", authenticate, ctrl.changePassword);
// router.post("/register", strictAuthLimiter, ctrl.register);
// router.post("/verify-otp", strictAuthLimiter, ctrl.verifyOtp);
// router.post("/resend-otp", strictAuthLimiter, ctrl.resendOtp);
// router.post("/login", strictAuthLimiter, ctrl.login);
// router.post("/forgot-password", strictAuthLimiter, ctrl.forgotPassword);
// router.post("/verify-reset-otp", strictAuthLimiter, ctrl.verifyResetOtp);
// router.post("/reset-password", strictAuthLimiter, ctrl.resetPassword);
// router.patch(
//   "/change-password",
//   authenticate,
//   strictAuthLimiter,
//   ctrl.changePassword,
// );

// --- GENEROUS ROUTES (Session handling & Data fetching) ---
router.post("/refresh-token", ctrl.refreshToken);
router.post("/logout", authenticate, ctrl.logout);
router.get("/me", authenticate, ctrl.getMe);
router.patch("/me", authenticate, ctrl.updateMe);
// router.post("/refresh-token", userProfileLimiter, ctrl.refreshToken);
// router.post("/logout", authenticate, userProfileLimiter, ctrl.logout);
// router.get("/me", authenticate, userProfileLimiter, ctrl.getMe);
// router.patch("/me", authenticate, userProfileLimiter, ctrl.updateMe);

module.exports = router;
