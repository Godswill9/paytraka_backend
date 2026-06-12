const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error, paginate } = require('../utils/response');
const { getPagination } = require('../utils/pagination');
const { audit } = require('../middlewares/audit.middleware');
const { AUDIT_ACTIONS, INVOICE_STATUS } = require('../config/constants');

const createPurchaseInvoice = async (req, res, next) => {
  try {
    const { supplier_id, invoice_number, issue_date, due_date, currency, notes, line_items } = req.body;
    if (!line_items?.length) return error(res, 'At least one line item is required', 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const id = uuidv4();
      let subtotal = 0, tax_total = 0;
      for (const item of line_items) {
        const lineTotal = item.quantity * item.unit_price;
        subtotal += lineTotal;
        tax_total += lineTotal * ((item.tax_rate || 0) / 100);
      }
      const total = subtotal + tax_total;

      await conn.query(
        `INSERT INTO purchase_invoices (id, company_id, supplier_id, invoice_number, issue_date, due_date, currency, subtotal, tax_total, total, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [id, req.user.company_id, supplier_id, invoice_number, issue_date, due_date, currency || 'NGN', subtotal, tax_total, total, notes]
      );

      for (const item of line_items) {
        const lineTotal = item.quantity * item.unit_price;
        const lineTax = lineTotal * ((item.tax_rate || 0) / 100);
        await conn.query(
          `INSERT INTO purchase_invoice_lineitems (id, invoice_id, product_id, description, quantity, unit_price, tax_rate, tax_amount, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, item.product_id || null, item.description, item.quantity, item.unit_price, item.tax_rate || 0, lineTax, lineTotal + lineTax]
        );
      }

      await conn.commit();
      conn.release();
      await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.CREATE, entity: 'purchase_invoice', entityId: id, req });
      return created(res, { id }, 'Purchase invoice created');
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (err) { next(err); }
};

const getPurchaseInvoices = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status } = req.query;
    let where = 'WHERE pi.company_id = ?';
    const params = [req.user.company_id];
    if (status) { where += ' AND pi.status = ?'; params.push(status); }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM purchase_invoices pi ${where}`, params);
    const [rows] = await pool.query(
      `SELECT pi.*, s.name as supplier_name FROM purchase_invoices pi
       LEFT JOIN suppliers s ON s.id = pi.supplier_id
       ${where} ORDER BY pi.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

const getPurchaseInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT pi.*, s.name as supplier_name, s.email as supplier_email
       FROM purchase_invoices pi
       LEFT JOIN suppliers s ON s.id = pi.supplier_id
       WHERE pi.id = ? AND pi.company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return error(res, 'Purchase invoice not found', 404);

    const [lineitems] = await pool.query(
      `SELECT pil.*, p.name as product_name FROM purchase_invoice_lineitems pil
       LEFT JOIN products p ON p.id = pil.product_id
       WHERE pil.invoice_id = ?`,
      [req.params.id]
    );
    return success(res, { ...rows[0], line_items: lineitems });
  } catch (err) { next(err); }
};

const updatePurchaseInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query('SELECT status FROM purchase_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!existing.length) return error(res, 'Invoice not found', 404);
    if (existing[0].status !== INVOICE_STATUS.DRAFT) return error(res, 'Only draft invoices can be edited', 400);

    const allowed = ['supplier_id', 'invoice_number', 'issue_date', 'due_date', 'currency', 'notes'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`).join(', ');
    const values = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (!sets) return error(res, 'No valid fields', 400);
    values.push(req.params.id, req.user.company_id);
    await pool.query(`UPDATE purchase_invoices SET ${sets}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    return success(res, {}, 'Purchase invoice updated');
  } catch (err) { next(err); }
};

const deletePurchaseInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query('SELECT status FROM purchase_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!existing.length) return error(res, 'Invoice not found', 404);
    if (existing[0].status !== INVOICE_STATUS.DRAFT) return error(res, 'Only draft invoices can be deleted', 400);
    await pool.query('DELETE FROM purchase_invoices WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Purchase invoice deleted');
  } catch (err) { next(err); }
};

const markPurchasePaid = async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE purchase_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    return success(res, {}, 'Purchase invoice marked as paid');
  } catch (err) { next(err); }
};

const getPurchaseLineitems = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT pil.*, p.name as product_name FROM purchase_invoice_lineitems pil
       LEFT JOIN products p ON p.id = pil.product_id
       WHERE pil.invoice_id = ?`,
      [req.params.id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

module.exports = { createPurchaseInvoice, getPurchaseInvoices, getPurchaseInvoice, updatePurchaseInvoice, deletePurchaseInvoice, markPurchasePaid, getPurchaseLineitems };
