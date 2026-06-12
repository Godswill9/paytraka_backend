const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { getFirsConfig, firsRequest } = require('../config/firs');
const { audit } = require('../middlewares/audit.middleware');
const { AUDIT_ACTIONS, FIRS_STATUS } = require('../config/constants');

// Get company mode
const getCompanyMode = async (companyId) => {
  const [[company]] = await pool.query('SELECT mode FROM companies WHERE id = ?', [companyId]);
  return company?.mode || 'demo';
};

// Authenticate with FIRS and get bearer token
const getFirsToken = async (mode) => {
  const config = getFirsConfig(mode);
  const axios = require('axios');
  const res = await axios.post(`${config.baseURL}/auth/token`, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'client_credentials',
  });
  return res.data.access_token;
};

// Map invoice to FIRS-compatible payload
const mapInvoiceToFirs = (invoice, company, lineitems) => {
  return {
    business_name: company.name,
    tin: company.tax_id,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.issue_date,
    due_date: invoice.due_date,
    currency: invoice.currency || 'NGN',
    buyer: {
      name: invoice.customer_name,
      tin: invoice.customer_tax_id || '',
      address: invoice.customer_address || '',
    },
    line_items: lineitems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
      tax_amount: item.tax_amount,
      total: item.total,
    })),
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    total: invoice.total,
  };
};

// POST /firs/submit (manual trigger per invoice)
const submitToFirs = async (req, res, next) => {
  try {
    const { invoice_id } = req.body;
    const mode = await getCompanyMode(req.user.company_id);

    // Fetch invoice + company
    const [invoices] = await pool.query(
      `SELECT si.*, c.name as customer_name, c.tax_id as customer_tax_id, c.address as customer_address
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [invoice_id, req.user.company_id]
    );
    if (!invoices.length) return error(res, 'Invoice not found', 404);

    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
    const [lineitems] = await pool.query('SELECT * FROM sales_invoice_lineitems WHERE invoice_id = ?', [invoice_id]);

    // Check if already submitted
    const [existing] = await pool.query(
      `SELECT id, status FROM firs_submissions WHERE invoice_id = ? AND status IN ('submitted', 'accepted')`,
      [invoice_id]
    );
    if (existing.length) return error(res, 'Invoice already submitted to FIRS', 409);

    const submissionId = uuidv4();
    const payload = mapInvoiceToFirs(invoices[0], company, lineitems);

    // Insert pending record
    await pool.query(
      `INSERT INTO firs_submissions (id, company_id, invoice_id, mode, payload, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [submissionId, req.user.company_id, invoice_id, mode, JSON.stringify(payload)]
    );

    try {
      // Transmit: chunk → validate → sign → submit
      const transmitResult = await transmitToFirs(payload, mode);

      await pool.query(
        `UPDATE firs_submissions SET status = 'submitted', irn = ?, response = ?, submitted_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [transmitResult.irn || null, JSON.stringify(transmitResult), submissionId]
      );

      await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.SUBMIT_FIRS, entity: 'sales_invoice', entityId: invoice_id, req });
      return success(res, { submission_id: submissionId, irn: transmitResult.irn }, 'Invoice submitted to FIRS successfully');
    } catch (firsErr) {
      await pool.query(
        `UPDATE firs_submissions SET status = 'failed', response = ?, updated_at = NOW() WHERE id = ?`,
        [JSON.stringify({ error: firsErr.message }), submissionId]
      );
      return error(res, `FIRS submission failed: ${firsErr.message}`, 502);
    }
  } catch (err) { next(err); }
};

// Core FIRS transmission: chunk → map → validate → sign → transmit
const transmitToFirs = async (payload, mode) => {
  const token = await getFirsToken(mode);
  const client = firsRequest(mode, token);

  // Step 1: Validate invoice payload
  const validateRes = await client.post('/invoice/validate', payload);
  if (!validateRes.data.valid) {
    throw new Error(`FIRS validation failed: ${JSON.stringify(validateRes.data.errors)}`);
  }

  // Step 2: Sign the invoice
  const signRes = await client.post('/invoice/sign', payload);
  const signedPayload = signRes.data.signed_payload;

  // Step 3: Transmit signed invoice
  const submitRes = await client.post('/invoice/submit', { signed_payload: signedPayload });
  return submitRes.data;
};

// POST /firs/transmit (bulk/chunked)
const transmitChunk = async (req, res, next) => {
  try {
    const { invoice_ids } = req.body;
    if (!invoice_ids?.length) return error(res, 'invoice_ids array required', 400);

    const CHUNK_SIZE = 10;
    const mode = await getCompanyMode(req.user.company_id);
    const results = [];

    const chunks = [];
    for (let i = 0; i < invoice_ids.length; i += CHUNK_SIZE) {
      chunks.push(invoice_ids.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      for (const invoice_id of chunk) {
        try {
          const [invoices] = await pool.query(
            `SELECT si.*, c.name as customer_name, c.tax_id as customer_tax_id, c.address as customer_address
             FROM sales_invoices si
             LEFT JOIN customers c ON c.id = si.customer_id
             WHERE si.id = ? AND si.company_id = ?`,
            [invoice_id, req.user.company_id]
          );
          if (!invoices.length) { results.push({ invoice_id, status: 'failed', reason: 'Not found' }); continue; }

          const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
          const [lineitems] = await pool.query('SELECT * FROM sales_invoice_lineitems WHERE invoice_id = ?', [invoice_id]);
          const payload = mapInvoiceToFirs(invoices[0], company, lineitems);

          const submissionId = uuidv4();
          await pool.query(
            `INSERT INTO firs_submissions (id, company_id, invoice_id, mode, payload, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
            [submissionId, req.user.company_id, invoice_id, mode, JSON.stringify(payload)]
          );

          const transmitResult = await transmitToFirs(payload, mode);
          await pool.query(
            `UPDATE firs_submissions SET status = 'submitted', irn = ?, response = ?, submitted_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [transmitResult.irn || null, JSON.stringify(transmitResult), submissionId]
          );
          results.push({ invoice_id, status: 'submitted', irn: transmitResult.irn });
        } catch (e) {
          results.push({ invoice_id, status: 'failed', reason: e.message });
        }
      }
    }

    return success(res, { results }, 'Bulk transmission complete');
  } catch (err) { next(err); }
};

// POST /firs/validate (pre-submission check only)
const validateInvoice = async (req, res, next) => {
  try {
    const { invoice_id } = req.body;
    const mode = await getCompanyMode(req.user.company_id);

    const [invoices] = await pool.query(
      `SELECT si.*, c.name as customer_name, c.tax_id as customer_tax_id, c.address as customer_address
       FROM sales_invoices si LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [invoice_id, req.user.company_id]
    );
    if (!invoices.length) return error(res, 'Invoice not found', 404);

    const [[company]] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
    const [lineitems] = await pool.query('SELECT * FROM sales_invoice_lineitems WHERE invoice_id = ?', [invoice_id]);
    const payload = mapInvoiceToFirs(invoices[0], company, lineitems);

    const token = await getFirsToken(mode);
    const client = firsRequest(mode, token);
    const res2 = await client.post('/invoice/validate', payload);

    return success(res, { valid: res2.data.valid, errors: res2.data.errors || [] }, 'Validation complete');
  } catch (err) { next(err); }
};

// GET /firs/submissions
const getSubmissions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT fs.*, si.invoice_number FROM firs_submissions fs
       LEFT JOIN sales_invoices si ON si.id = fs.invoice_id
       WHERE fs.company_id = ? ORDER BY fs.created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// GET /firs/submissions/:id
const getSubmission = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT fs.*, si.invoice_number FROM firs_submissions fs
       LEFT JOIN sales_invoices si ON si.id = fs.invoice_id
       WHERE fs.id = ? AND fs.company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return error(res, 'Submission not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// GET /firs/status/:irn
const getIrnStatus = async (req, res, next) => {
  try {
    const mode = await getCompanyMode(req.user.company_id);
    const token = await getFirsToken(mode);
    const client = firsRequest(mode, token);
    const response = await client.get(`/invoice/status/${req.params.irn}`);
    return success(res, response.data);
  } catch (err) { next(err); }
};

module.exports = { submitToFirs, transmitChunk, validateInvoice, getSubmissions, getSubmission, getIrnStatus };
