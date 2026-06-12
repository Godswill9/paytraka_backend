const router = require('express').Router();
const ctrl = require('../controllers/purchaseInvoice.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/', ctrl.createPurchaseInvoice);
router.get('/', ctrl.getPurchaseInvoices);
router.get('/:id', ctrl.getPurchaseInvoice);
router.patch('/:id', ctrl.updatePurchaseInvoice);
router.delete('/:id', ctrl.deletePurchaseInvoice);
router.post('/:id/mark-paid', ctrl.markPurchasePaid);
router.get('/:id/lineitems', ctrl.getPurchaseLineitems);

module.exports = router;
