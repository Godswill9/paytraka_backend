const router = require('express').Router();
const ctrl = require('../controllers/customer.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadImport } = require('../middlewares/upload.middleware');

router.use(authenticate);

router.get('/export', ctrl.exportCustomers);
router.post('/import', uploadImport.single('file'), ctrl.importCustomers);
router.post('/', ctrl.createCustomer);
router.get('/', ctrl.getCustomers);
router.get('/:id', ctrl.getCustomer);
router.patch('/:id', ctrl.updateCustomer);
router.delete('/:id', ctrl.deleteCustomer);

module.exports = router;
