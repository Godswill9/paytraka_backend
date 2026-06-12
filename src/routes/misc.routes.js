const router = require('express').Router();
const misc = require('../controllers/misc.controller');
const paymentLinkCtrl = require('../controllers/paymentLink.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadDocument, uploadImport } = require('../middlewares/upload.middleware');

router.use(authenticate);

// ── Invoice Payments ──────────────────────────────────────
router.post('/invoice-payments', misc.createInvoicePayment);
router.get('/invoice-payments', misc.getInvoicePayments);
router.get('/invoice-payments/:id', misc.getInvoicePayment);
router.delete('/invoice-payments/:id', misc.deleteInvoicePayment);

// ── Invoice Templates ─────────────────────────────────────
router.post('/invoice-templates', misc.createTemplate);
router.get('/invoice-templates', misc.getTemplates);
router.get('/invoice-templates/:id', misc.getTemplate);
router.patch('/invoice-templates/:id', misc.updateTemplate);
router.delete('/invoice-templates/:id', misc.deleteTemplate);

// ── API Keys ──────────────────────────────────────────────
router.post('/api-keys', misc.createApiKey);
router.get('/api-keys', misc.getApiKeys);
router.delete('/api-keys/:id', misc.deleteApiKey);
router.patch('/api-keys/:id/regenerate', misc.regenerateApiKey);

// ── Notifications ─────────────────────────────────────────
router.get('/notifications', misc.getNotifications);
router.patch('/notifications/read-all', misc.markAllNotificationsRead);
router.patch('/notifications/:id/read', misc.markNotificationRead);
router.delete('/notifications/:id', misc.deleteNotification);

// ── Webhooks ──────────────────────────────────────────────
router.post('/webhooks', misc.createWebhook);
router.get('/webhooks', misc.getWebhooks);
router.get('/webhooks/:id', misc.getWebhook);
router.patch('/webhooks/:id', misc.updateWebhook);
router.delete('/webhooks/:id', misc.deleteWebhook);
router.post('/webhooks/:id/test', misc.testWebhook);

// ── Withdrawal Accounts ───────────────────────────────────
router.post('/withdrawal-accounts', misc.createWithdrawalAccount);
router.get('/withdrawal-accounts', misc.getWithdrawalAccounts);
router.delete('/withdrawal-accounts/:id', misc.deleteWithdrawalAccount);

// ── Withdrawals ───────────────────────────────────────────
router.post('/withdrawals', misc.createWithdrawal);
router.get('/withdrawals', misc.getWithdrawals);
router.get('/withdrawals/:id', misc.getWithdrawal);

// ── Registration Codes ────────────────────────────────────
router.post('/registration-codes', misc.createRegCode);
router.get('/registration-codes', misc.getRegCodes);
router.delete('/registration-codes/:id', misc.deleteRegCode);
router.patch('/registration-codes/:id/deactivate', misc.deactivateRegCode);

// ── Support Tickets ───────────────────────────────────────
router.post('/support-tickets', misc.createTicket);
router.get('/support-tickets', misc.getTickets);
router.get('/support-tickets/:id', misc.getTicket);
router.patch('/support-tickets/:id', misc.updateTicket);
router.delete('/support-tickets/:id', misc.deleteTicket);

// ── Audit Logs ────────────────────────────────────────────
router.get('/audit-logs', misc.getAuditLogs);
router.get('/audit-logs/:id', misc.getAuditLog);

// ── File Uploads ──────────────────────────────────────────
router.post('/files/upload', uploadDocument.single('file'), misc.uploadFile);
router.delete('/files/:id', misc.deleteFile);

// ── Payment Links ─────────────────────────────────────────
router.post('/payment-links', paymentLinkCtrl.createPaymentLink);
router.get('/payment-links', paymentLinkCtrl.getPaymentLinks);
router.get('/payment-links/:id', paymentLinkCtrl.getPaymentLink);
router.delete('/payment-links/:id', paymentLinkCtrl.deletePaymentLink);

module.exports = router;
