const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error, paginate } = require('../utils/response');
const { getPagination, buildSearch } = require('../utils/pagination');
const { audit } = require('../middlewares/audit.middleware');
const { AUDIT_ACTIONS, INVOICE_STATUS } = require('../config/constants');

// Generate invoice number: INV-2024-0001
const generateInvoiceNumber = async (companyId) => {
  const year = new Date().getFullYear();
  const [[{ count }]] = await pool.query(
    `SELECT COUNT(*) as count FROM sales_invoices WHERE company_id = ? AND YEAR(created_at) = ?`,
    [companyId, year]
  );
  const seq = String(count + 1).padStart(4, '0');

  const [settings] = await pool.query('SELECT invoice_prefix FROM company_settings WHERE company_id = ?', [companyId]);
  const prefix = settings[0]?.invoice_prefix || 'INV';
  return `${prefix}-${year}-${seq}`;
};

// POST /sales-invoices
const createInvoice = async (req, res, next) => {
  try {
    const { customer_id, issue_date, due_date, currency, notes, line_items, template_id } = req.body;
    if (!line_items?.length) return error(res, 'At least one line item is required', 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const id = uuidv4();
      const invoice_number = await generateInvoiceNumber(req.user.company_id);

      // Calculate totals
      let subtotal = 0, tax_total = 0;
      for (const item of line_items) {
        const lineTotal = item.quantity * item.unit_price;
        const lineTax = lineTotal * ((item.tax_rate || 0) / 100);
        subtotal += lineTotal;
        tax_total += lineTax;
      }
      const total = subtotal + tax_total;

      await conn.query(
        `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, issue_date, due_date, currency, subtotal, tax_total, total, notes, status, template_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [id, req.user.company_id, customer_id, invoice_number, issue_date, due_date, currency || 'NGN', subtotal, tax_total, total, notes, template_id || null]
      );

      for (const item of line_items) {
        const lineTotal = item.quantity * item.unit_price;
        const lineTax = lineTotal * ((item.tax_rate || 0) / 100);
        await conn.query(
          `INSERT INTO sales_invoice_lineitems (id, invoice_id, product_id, description, quantity, unit_price, tax_rate, tax_amount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, item.product_id || null, item.description, item.quantity, item.unit_price, item.tax_rate || 0, lineTax, lineTotal + lineTax]
        );
      }

      await conn.commit();
      conn.release();

      await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.CREATE, entity: 'sales_invoice', entityId: id, req });
      return created(res, { id, invoice_number }, 'Invoice created');
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (err) { next(err); }
};

// GET /sales-invoices
const getInvoices = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, customer_id } = req.query;
    const { clause, values } = buildSearch(['si.invoice_number', 'c.name'], req.query.search);

    let where = 'WHERE si.company_id = ?';
    const params = [req.user.company_id];

    if (status) { where += ' AND si.status = ?'; params.push(status); }
    if (customer_id) { where += ' AND si.customer_id = ?'; params.push(customer_id); }
    if (clause) { where += ` AND ${clause}`; params.push(...values); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM sales_invoices si LEFT JOIN customers c ON c.id = si.customer_id ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT si.*, c.name as customer_name, c.email as customer_email
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       ${where} ORDER BY si.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

// GET /sales-invoices/:id
const getInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT si.*, c.name as customer_name, c.email as customer_email, c.address as customer_address,
              c.phone as customer_phone, c.tax_id as customer_tax_id
       FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return error(res, 'Invoice not found', 404);

    const [lineitems] = await pool.query(
      `SELECT sil.*, p.name as product_name FROM sales_invoice_lineitems sil
       LEFT JOIN products p ON p.id = sil.product_id
       WHERE sil.invoice_id = ?`,
      [req.params.id]
    );

    return success(res, { ...rows[0], line_items: lineitems });
  } catch (err) { next(err); }
};

// PATCH /sales-invoices/:id
const updateInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query('SELECT status FROM sales_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!existing.length) return error(res, 'Invoice not found', 404);
    if (existing[0].status !== INVOICE_STATUS.DRAFT) return error(res, 'Only draft invoices can be edited', 400);

    const allowed = ['customer_id', 'issue_date', 'due_date', 'currency', 'notes', 'template_id'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`).join(', ');
    const values = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (!sets) return error(res, 'No valid fields', 400);
    values.push(req.params.id, req.user.company_id);
    await pool.query(`UPDATE sales_invoices SET ${sets}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.UPDATE, entity: 'sales_invoice', entityId: req.params.id, req });
    return success(res, {}, 'Invoice updated');
  } catch (err) { next(err); }
};

// DELETE /sales-invoices/:id
const deleteInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query('SELECT status FROM sales_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!existing.length) return error(res, 'Invoice not found', 404);
    if (existing[0].status !== INVOICE_STATUS.DRAFT) return error(res, 'Only draft invoices can be deleted', 400);
    await pool.query('DELETE FROM sales_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Invoice deleted');
  } catch (err) { next(err); }
};

// POST /sales-invoices/:id/send
const sendInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sales_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Invoice not found', 404);
    // TODO: Send email to customer
    await pool.query(`UPDATE sales_invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = ?`, [req.params.id]);
    return success(res, {}, 'Invoice sent to customer');
  } catch (err) { next(err); }
};

// POST /sales-invoices/:id/mark-paid
const markPaid = async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE sales_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    return success(res, {}, 'Invoice marked as paid');
  } catch (err) { next(err); }
};

// GET /sales-invoices/:id/lineitems
const getLineitems = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT sil.*, p.name as product_name FROM sales_invoice_lineitems sil
       LEFT JOIN products p ON p.id = sil.product_id
       WHERE sil.invoice_id = ?`,
      [req.params.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

module.exports = { createInvoice, getInvoices, getInvoice, updateInvoice, deleteInvoice, sendInvoice, markPaid, getLineitems };
