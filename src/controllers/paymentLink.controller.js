const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error } = require('../utils/response');
const { paystackRequest } = require('../config/paystack');

// POST /payment-links
const createPaymentLink = async (req, res, next) => {
  try {
    const { invoice_id, amount, description } = req.body;

    const [[company]] = await pool.query('SELECT mode FROM companies WHERE id = ?', [req.user.company_id]);
    const mode = company.mode;

    const [invoices] = await pool.query(
      `SELECT si.*, c.email as customer_email FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [invoice_id, req.user.company_id]
    );
    if (!invoices.length) return error(res, 'Invoice not found', 404);

    const invoice = invoices[0];
    const paystack = paystackRequest(mode);
    const ref = `PAY-${uuidv4()}`;

    const initRes = await paystack.post('/transaction/initialize', {
      email: invoice.customer_email,
      amount: Math.round((amount || invoice.total) * 100),
      reference: ref,
      callback_url: `${process.env.APP_URL}/payments/callback?invoice_id=${invoice_id}`,
      metadata: {
        invoice_id,
        company_id: req.user.company_id,
        mode,
      },
    });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO payment_links (id, company_id, invoice_id, reference, amount, description, payment_url, mode, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [id, req.user.company_id, invoice_id, ref, amount || invoice.total, description || `Payment for ${invoice.invoice_number}`, initRes.data.data.authorization_url, mode]
    );

    return created(res, {
      id,
      payment_url: initRes.data.data.authorization_url,
      reference: ref,
      mode,
    }, `Payment link generated (${mode} mode)`);
  } catch (err) { next(err); }
};

// GET /payment-links
const getPaymentLinks = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT pl.*, si.invoice_number FROM payment_links pl
       LEFT JOIN sales_invoices si ON si.id = pl.invoice_id
       WHERE pl.company_id = ? ORDER BY pl.created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// GET /payment-links/:id
const getPaymentLink = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM payment_links WHERE id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return error(res, 'Payment link not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// DELETE /payment-links/:id
const deletePaymentLink = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM payment_links WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Payment link deleted');
  } catch (err) { next(err); }
};

module.exports = { createPaymentLink, getPaymentLinks, getPaymentLink, deletePaymentLink };
