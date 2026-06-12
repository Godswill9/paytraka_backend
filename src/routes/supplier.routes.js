const router = require('express').Router();
const ctrl = require('../controllers/supplier.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadImport } = require('../middlewares/upload.middleware');

router.use(authenticate);

router.get('/export', ctrl.exportSuppliers);
router.post('/import', uploadImport.single('file'), ctrl.importSuppliers);
router.post('/', ctrl.createSupplier);
router.get('/', ctrl.getSuppliers);
router.get('/:id', ctrl.getSupplier);
router.patch('/:id', ctrl.updateSupplier);
router.delete('/:id', ctrl.deleteSupplier);

module.exports = router;
