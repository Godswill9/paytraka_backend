const router = require('express').Router();
const ctrl = require('../controllers/subscription.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Public Paystack webhook — NO auth (Paystack calls this directly)
router.post('/paystack/webhook', ctrl.paystackWebhook);
router.get('/paystack/callback', ctrl.paystackCallback);

// Protected routes
router.use(authenticate);

router.get('/subscription-plans', ctrl.getPlans);
router.get('/subscription-plans/:id', ctrl.getPlan);
router.get('/subscription', ctrl.getSubscription);
router.patch('/subscription/cancel', ctrl.cancelSubscription);
router.post('/initialize-subscription', ctrl.initializeSubscription);
router.get('/subscription-payments', ctrl.getSubscriptionPayments);

module.exports = router;
