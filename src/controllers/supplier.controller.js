const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error, paginate } = require('../utils/response');
const { getPagination, buildSearch } = require('../utils/pagination');
const { parseImportFile, generateTemplate, generateExport, SUPPLIER_HEADERS } = require('../utils/importExport');
const { audit } = require('../middlewares/audit.middleware');
const { AUDIT_ACTIONS } = require('../config/constants');

const createSupplier = async (req, res, next) => {
  try {
    const { name, email, phone, address, city, state, country, tax_id, bank_name, account_number } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO suppliers (id, company_id, name, email, phone, address, city, state, country, tax_id, bank_name, account_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.company_id, name, email, phone, address, city, state, country, tax_id, bank_name, account_number]
    );
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.CREATE, entity: 'supplier', entityId: id, req });
    return created(res, { id }, 'Supplier created');
  } catch (err) { next(err); }
};

const getSuppliers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { clause, values } = buildSearch(['name', 'email', 'phone'], req.query.search);
    const where = `WHERE company_id = ? ${clause ? `AND ${clause}` : ''}`;
    const params = [req.user.company_id, ...values];
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM suppliers ${where}`, params);
    const [rows] = await pool.query(`SELECT * FROM suppliers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

const getSupplier = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    if (!rows.length) return error(res, 'Supplier not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const updateSupplier = async (req, res, next) => {
  try {
    const allowed = ['name', 'email', 'phone', 'address', 'city', 'state', 'country', 'tax_id', 'bank_name', 'account_number'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`).join(', ');
    const values = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (!sets) return error(res, 'No valid fields', 400);
    values.push(req.params.id, req.user.company_id);
    await pool.query(`UPDATE suppliers SET ${sets}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.UPDATE, entity: 'supplier', entityId: req.params.id, req });
    return success(res, {}, 'Supplier updated');
  } catch (err) { next(err); }
};

const deleteSupplier = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.DELETE, entity: 'supplier', entityId: req.params.id, req });
    return success(res, {}, 'Supplier deleted');
  } catch (err) { next(err); }
};

const exportSuppliers = async (req, res, next) => {
  try {
    const { type = 'template' } = req.query;
    if (type === 'template') {
      const buffer = generateTemplate(SUPPLIER_HEADERS, 'Suppliers');
      res.setHeader('Content-Disposition', 'attachment; filename=suppliers_template.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
    }
    const [rows] = await pool.query(
      `SELECT name, email, phone, address, city, state, country, tax_id, bank_name, account_number FROM suppliers WHERE company_id = ?`,
      [req.user.company_id]
    );
    const buffer = generateExport(rows, 'Suppliers');
    res.setHeader('Content-Disposition', 'attachment; filename=suppliers_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.EXPORT, entity: 'supplier', req });
    return res.send(buffer);
  } catch (err) { next(err); }
};

const importSuppliers = async (req, res, next) => {
  try {
    if (!req.file) return error(res, 'File is required', 400);
    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return error(res, 'File is empty', 400);
    let inserted = 0, failed = 0, errors = [];
    for (const row of rows) {
      if (!row.name) { failed++; errors.push({ row, reason: 'name is required' }); continue; }
      try {
        await pool.query(
          `INSERT INTO suppliers (id, company_id, name, email, phone, address, city, state, country, tax_id, bank_name, account_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), req.user.company_id, row.name, row.email || null, row.phone || null, row.address || null, row.city || null, row.state || null, row.country || null, row.tax_id || null, row.bank_name || null, row.account_number || null]
        );
        inserted++;
      } catch (e) { failed++; errors.push({ row, reason: e.message }); }
    }
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.IMPORT, entity: 'supplier', details: { inserted, failed }, req });
    return success(res, { inserted, failed, errors }, `Import complete: ${inserted} inserted, ${failed} failed`);
  } catch (err) { next(err); }
};

module.exports = { createSupplier, getSuppliers, getSupplier, updateSupplier, deleteSupplier, exportSuppliers, importSuppliers };
