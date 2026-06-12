const router = require('express').Router();
const ctrl = require('../controllers/company.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadImage } = require('../middlewares/upload.middleware');

router.use(authenticate);

router.get('/:id', ctrl.getCompany);
router.patch('/:id', uploadImage.single('logo'), ctrl.updateCompany);
router.patch('/:id/kyc', uploadImage.single('logo'), ctrl.submitKyc);
router.patch('/:id/firs-settings', ctrl.updateFirsSettings);
router.patch('/:id/nrs-credentials', ctrl.updateNrsCredentials);
router.get('/:id/mode', ctrl.getMode);
router.patch('/:id/mode', ctrl.switchMode);
router.get('/:id/settings', ctrl.getSettings);
router.patch('/:id/settings', ctrl.updateSettings);

module.exports = router;
