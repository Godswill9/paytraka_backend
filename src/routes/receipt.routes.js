const router = require('express').Router();
const ctrl = require('../controllers/receipt.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/', ctrl.createReceipt);
router.get('/', ctrl.getReceipts);
router.get('/invoice/:invoiceId', ctrl.getReceiptsByInvoice);
router.get('/:id', ctrl.getReceipt);
router.post('/:id/send', ctrl.sendReceipt);
router.delete('/:id', ctrl.deleteReceipt);

module.exports = router;
