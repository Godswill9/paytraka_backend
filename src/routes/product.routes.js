const router = require('express').Router();
const ctrl = require('../controllers/product.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadImport } = require('../middlewares/upload.middleware');

router.use(authenticate);

// Categories
router.get('/categories', ctrl.getCategories);
router.post('/categories', ctrl.createCategory);
router.patch('/categories/:id', ctrl.updateCategory);
router.delete('/categories/:id', ctrl.deleteCategory);

// Products
router.get('/export', ctrl.exportProducts);
router.post('/import', uploadImport.single('file'), ctrl.importProducts);
router.post('/', ctrl.createProduct);
router.get('/', ctrl.getProducts);
router.get('/:id', ctrl.getProduct);
router.patch('/:id', ctrl.updateProduct);
router.delete('/:id', ctrl.deleteProduct);

module.exports = router;
