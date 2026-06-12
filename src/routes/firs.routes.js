const router = require('express').Router();
const ctrl = require('../controllers/firs.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/submit', ctrl.submitToFirs);
router.post('/transmit', ctrl.transmitChunk);
router.post('/validate', ctrl.validateInvoice);
router.get('/submissions', ctrl.getSubmissions);
router.get('/submissions/:id', ctrl.getSubmission);
router.get('/status/:irn', ctrl.getIrnStatus);

module.exports = router;
