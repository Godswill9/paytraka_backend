const express = require("express");
const router = express.Router();

const {
  submitToFirs,
  updateInvoicePaymentStatus,
  getInvoiceQrCode,
  getBusinessHealthCheck,
  getSubmissions,
  getSubmission,
} = require("../controllers/firs.controller");

const { authenticate } = require("../middlewares/auth.middleware");

router.use(authenticate);

// Submit an invoice to FIRS
router.post("/submit", submitToFirs);

// Update an invoice's payment status on FIRS (PAID / UNPAID)
router.post("/payment-status", updateInvoicePaymentStatus);

// Get FIRS QR code for a submitted invoice
router.get("/invoices/:invoiceId/qr", getInvoiceQrCode);

// FIRS business health check
router.get("/health", getBusinessHealthCheck);

// Submission history
router.get("/submissions", getSubmissions);
router.get("/submissions/:id", getSubmission);

module.exports = router;
