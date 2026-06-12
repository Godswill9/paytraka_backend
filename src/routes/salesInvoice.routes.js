const router = require('express').Router();
const ctrl = require('../controllers/salesInvoice.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/', ctrl.createInvoice);
router.get('/', ctrl.getInvoices);
router.get('/:id', ctrl.getInvoice);
router.patch('/:id', ctrl.updateInvoice);
router.delete('/:id', ctrl.deleteInvoice);
router.post('/:id/send', ctrl.sendInvoice);
router.post('/:id/mark-paid', ctrl.markPaid);
router.get('/:id/lineitems', ctrl.getLineitems);

module.exports = router;
