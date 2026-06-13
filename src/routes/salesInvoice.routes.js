const router = require("express").Router();
const ctrl = require("../controllers/salesInvoice.controller");
const receiptCtrl = require("../controllers/receipt.controller");
const { authenticate } = require("../middlewares/auth.middleware");

router.use(authenticate);

router.post("/", ctrl.createInvoice);
router.get("/", ctrl.getInvoices);
router.get("/:id", ctrl.getInvoice);
router.patch("/:id", ctrl.updateInvoice);
router.delete("/:id", ctrl.deleteInvoice);
router.post("/:id/post", ctrl.postInvoice);
router.post("/:id/send", ctrl.sendInvoice);
router.post("/:id/cancel", ctrl.cancelInvoice);
router.post("/:id/convert-to-invoice", ctrl.convertProformaToInvoice);

// mark-paid settles balance + auto-generates a receipt
router.post("/:id/mark-paid", receiptCtrl.markInvoicePaidWithReceipt);

router.get("/:id/lineitems", ctrl.getLineitems);

module.exports = router;
