// ===================== INVOICE PAYMENTS =====================
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error, paginate } = require('../utils/response');
const { getPagination } = require('../utils/pagination');
const { uploadToCloudflare, deleteFromCloudflare } = require('../config/cloudflare');

const createInvoicePayment = async (req, res, next) => {
  try {
    const { invoice_id, amount, payment_date, payment_method, reference, notes } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO invoice_payments (id, company_id, invoice_id, amount, payment_date, payment_method, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.company_id, invoice_id, amount, payment_date, payment_method, reference, notes]
    );
    // Check if invoice is fully paid
    const [[inv]] = await pool.query('SELECT total FROM sales_invoices WHERE id = ?', [invoice_id]);
    const [[{ paid }]] = await pool.query('SELECT SUM(amount) as paid FROM invoice_payments WHERE invoice_id = ?', [invoice_id]);
    if (paid >= inv.total) {
      await pool.query(`UPDATE sales_invoices SET status = 'paid', paid_at = NOW() WHERE id = ?`, [invoice_id]);
    }
    return created(res, { id }, 'Payment recorded');
  } catch (err) { next(err); }
};

const getInvoicePayments = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM invoice_payments WHERE company_id = ?', [req.user.company_id]);
    const [rows] = await pool.query(
      `SELECT ip.*, si.invoice_number FROM invoice_payments ip
       LEFT JOIN sales_invoices si ON si.id = ip.invoice_id
       WHERE ip.company_id = ? ORDER BY ip.payment_date DESC LIMIT ? OFFSET ?`,
      [req.user.company_id, limit, offset]
    );
    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

const getInvoicePayment = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM invoice_payments WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Payment not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const deleteInvoicePayment = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM invoice_payments WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Payment deleted');
  } catch (err) { next(err); }
};

// ===================== INVOICE TEMPLATES =====================
const createTemplate = async (req, res, next) => {
  try {
    const { name, content, is_default } = req.body;
    const id = uuidv4();
    if (is_default) {
      await pool.query('UPDATE invoice_templates SET is_default = 0 WHERE company_id = ?', [req.user.company_id]);
    }
    await pool.query(
      `INSERT INTO invoice_templates (id, company_id, name, content, is_default) VALUES (?, ?, ?, ?, ?)`,
      [id, req.user.company_id, name, JSON.stringify(content), is_default ? 1 : 0]
    );
    return created(res, { id }, 'Template created');
  } catch (err) { next(err); }
};

const getTemplates = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM invoice_templates WHERE company_id = ? ORDER BY created_at DESC', [req.user.company_id]);
    return success(res, rows);
  } catch (err) { next(err); }
};

const getTemplate = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM invoice_templates WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Template not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const updateTemplate = async (req, res, next) => {
  try {
    const { name, content, is_default } = req.body;
    if (is_default) {
      await pool.query('UPDATE invoice_templates SET is_default = 0 WHERE company_id = ?', [req.user.company_id]);
    }
    await pool.query(
      `UPDATE invoice_templates SET name = ?, content = ?, is_default = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [name, JSON.stringify(content), is_default ? 1 : 0, req.params.id, req.user.company_id]
    );
    return success(res, {}, 'Template updated');
  } catch (err) { next(err); }
};

const deleteTemplate = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM invoice_templates WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Template deleted');
  } catch (err) { next(err); }
};

// ===================== API KEYS =====================
const createApiKey = async (req, res, next) => {
  try {
    const { name } = req.body;
    const key = `pk_${req.user.company_id.replace(/-/g, '').slice(0, 8)}_${uuidv4().replace(/-/g, '')}`;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO api_keys (id, company_id, name, key_value) VALUES (?, ?, ?, ?)`,
      [id, req.user.company_id, name, key]
    );
    return created(res, { id, key }, 'API key created — copy it now, it will not be shown again');
  } catch (err) { next(err); }
};

const getApiKeys = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, CONCAT(LEFT(key_value, 12), '...') as key_preview, is_active, last_used_at, created_at
       FROM api_keys WHERE company_id = ? ORDER BY created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

const deleteApiKey = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM api_keys WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'API key deleted');
  } catch (err) { next(err); }
};

const regenerateApiKey = async (req, res, next) => {
  try {
    const key = `pk_${req.user.company_id.replace(/-/g, '').slice(0, 8)}_${uuidv4().replace(/-/g, '')}`;
    await pool.query(
      `UPDATE api_keys SET key_value = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [key, req.params.id, req.user.company_id]
    );
    return success(res, { key }, 'API key regenerated — copy it now');
  } catch (err) { next(err); }
};

// ===================== NOTIFICATIONS =====================
const getNotifications = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

const markNotificationRead = async (req, res, next) => {
  try {
    await pool.query(`UPDATE notification SET is_read = 1, updated_at = NOW() WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    return success(res, {}, 'Marked as read');
  } catch (err) { next(err); }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    await pool.query(`UPDATE notification SET is_read = 1, updated_at = NOW() WHERE user_id = ?`, [req.user.id]);
    return success(res, {}, 'All marked as read');
  } catch (err) { next(err); }
};

const deleteNotification = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM notification WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    return success(res, {}, 'Notification deleted');
  } catch (err) { next(err); }
};

// ===================== WEBHOOKS =====================
const createWebhook = async (req, res, next) => {
  try {
    const { url, events, secret } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO webhooks (id, company_id, url, events, secret, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
      [id, req.user.company_id, url, JSON.stringify(events), secret || null]
    );
    return created(res, { id }, 'Webhook created');
  } catch (err) { next(err); }
};

const getWebhooks = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, url, events, is_active, created_at FROM webhooks WHERE company_id = ?', [req.user.company_id]);
    return success(res, rows);
  } catch (err) { next(err); }
};

const getWebhook = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM webhooks WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Webhook not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const updateWebhook = async (req, res, next) => {
  try {
    const { url, events, is_active } = req.body;
    await pool.query(
      `UPDATE webhooks SET url = ?, events = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [url, JSON.stringify(events), is_active ? 1 : 0, req.params.id, req.user.company_id]
    );
    return success(res, {}, 'Webhook updated');
  } catch (err) { next(err); }
};

const deleteWebhook = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM webhooks WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Webhook deleted');
  } catch (err) { next(err); }
};

const testWebhook = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT url FROM webhooks WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Webhook not found', 404);
    const axios = require('axios');
    await axios.post(rows[0].url, { event: 'test', data: { message: 'Webhook test from PayTraka' } });
    return success(res, {}, 'Test payload sent');
  } catch (err) { next(err); }
};

// ===================== WITHDRAWALS =====================
const createWithdrawalAccount = async (req, res, next) => {
  try {
    const { bank_name, account_number, account_name, bank_code } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO withdrawal_accounts (id, company_id, bank_name, account_number, account_name, bank_code) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.user.company_id, bank_name, account_number, account_name, bank_code]
    );
    return created(res, { id }, 'Withdrawal account added');
  } catch (err) { next(err); }
};

const getWithdrawalAccounts = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM withdrawal_accounts WHERE company_id = ?', [req.user.company_id]);
    return success(res, rows);
  } catch (err) { next(err); }
};

const deleteWithdrawalAccount = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM withdrawal_accounts WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Withdrawal account removed');
  } catch (err) { next(err); }
};

const createWithdrawal = async (req, res, next) => {
  try {
    const { account_id, amount, note } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO withdrawals (id, company_id, account_id, amount, note, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, req.user.company_id, account_id, amount, note]
    );
    return created(res, { id }, 'Withdrawal request submitted');
  } catch (err) { next(err); }
};

const getWithdrawals = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.*, wa.bank_name, wa.account_number, wa.account_name FROM withdrawals w
       LEFT JOIN withdrawal_accounts wa ON wa.id = w.account_id
       WHERE w.company_id = ? ORDER BY w.created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

const getWithdrawal = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM withdrawals WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Withdrawal not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ===================== REGISTRATION CODES =====================
const createRegCode = async (req, res, next) => {
  try {
    const { code, max_uses, expires_at } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO registration_codes (id, code, max_uses, expires_at, is_active) VALUES (?, ?, ?, ?, 1)`,
      [id, code || uuidv4().slice(0, 8).toUpperCase(), max_uses || null, expires_at || null]
    );
    return created(res, { id }, 'Registration code created');
  } catch (err) { next(err); }
};

const getRegCodes = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM registration_codes ORDER BY created_at DESC');
    return success(res, rows);
  } catch (err) { next(err); }
};

const deleteRegCode = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM registration_codes WHERE id = ?', [req.params.id]);
    return success(res, {}, 'Registration code deleted');
  } catch (err) { next(err); }
};

const deactivateRegCode = async (req, res, next) => {
  try {
    await pool.query(`UPDATE registration_codes SET is_active = 0, updated_at = NOW() WHERE id = ?`, [req.params.id]);
    return success(res, {}, 'Registration code deactivated');
  } catch (err) { next(err); }
};

// ===================== SUPPORT TICKETS =====================
const createTicket = async (req, res, next) => {
  try {
    const { subject, message, priority } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO support_tickets (id, company_id, user_id, subject, message, priority, status) VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [id, req.user.company_id, req.user.id, subject, message, priority || 'medium']
    );
    return created(res, { id }, 'Support ticket created');
  } catch (err) { next(err); }
};

const getTickets = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM support_tickets WHERE company_id = ? ORDER BY created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

const getTicket = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM support_tickets WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Ticket not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const updateTicket = async (req, res, next) => {
  try {
    const { status, priority } = req.body;
    await pool.query(
      `UPDATE support_tickets SET status = ?, priority = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [status, priority, req.params.id, req.user.company_id]
    );
    return success(res, {}, 'Ticket updated');
  } catch (err) { next(err); }
};

const deleteTicket = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM support_tickets WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Ticket deleted');
  } catch (err) { next(err); }
};

// ===================== AUDIT LOGS =====================
const getAuditLogs = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM audit_logs WHERE company_id = ?', [req.user.company_id]);
    const [rows] = await pool.query(
      `SELECT * FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.company_id, limit, offset]
    );
    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

const getAuditLog = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Log not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ===================== FILE UPLOADS =====================
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) return error(res, 'File is required', 400);
    const folder = req.body.folder || 'uploads';
    const { key, url } = await uploadToCloudflare(req.file.buffer, req.file.originalname, folder);
    return created(res, { key, url }, 'File uploaded');
  } catch (err) { next(err); }
};

const deleteFile = async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return error(res, 'File key required', 400);
    await deleteFromCloudflare(key);
    return success(res, {}, 'File deleted');
  } catch (err) { next(err); }
};

// ===================== PAGINATE EXPORT =====================
const { paginate: paginateRes } = require('../utils/response');

module.exports = {
  // Invoice payments
  createInvoicePayment, getInvoicePayments, getInvoicePayment, deleteInvoicePayment,
  // Templates
  createTemplate, getTemplates, getTemplate, updateTemplate, deleteTemplate,
  // API Keys
  createApiKey, getApiKeys, deleteApiKey, regenerateApiKey,
  // Notifications
  getNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
  // Webhooks
  createWebhook, getWebhooks, getWebhook, updateWebhook, deleteWebhook, testWebhook,
  // Withdrawals
  createWithdrawalAccount, getWithdrawalAccounts, deleteWithdrawalAccount,
  createWithdrawal, getWithdrawals, getWithdrawal,
  // Reg codes
  createRegCode, getRegCodes, deleteRegCode, deactivateRegCode,
  // Tickets
  createTicket, getTickets, getTicket, updateTicket, deleteTicket,
  // Audit
  getAuditLogs, getAuditLog,
  // Files
  uploadFile, deleteFile,
};
