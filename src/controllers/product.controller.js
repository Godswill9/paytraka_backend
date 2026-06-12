const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/db');
const { success, created, error, paginate } = require('../utils/response');
const { getPagination, buildSearch } = require('../utils/pagination');
const { parseImportFile, generateTemplate, generateExport, PRODUCT_HEADERS } = require('../utils/importExport');
const { audit } = require('../middlewares/audit.middleware');
const { AUDIT_ACTIONS } = require('../config/constants');

const createProduct = async (req, res, next) => {
  try {
    const { name, description, unit_price, unit, category_id, tax_rate } = req.body;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO products (id, company_id, name, description, unit_price, unit, category_id, tax_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.company_id, name, description, unit_price, unit, category_id || null, tax_rate || 0]
    );
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.CREATE, entity: 'product', entityId: id, req });
    return created(res, { id }, 'Product created');
  } catch (err) { next(err); }
};

const getProducts = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { clause, values } = buildSearch(['p.name', 'p.description'], req.query.search);
    const where = `WHERE p.company_id = ? ${clause ? `AND ${clause}` : ''}`;
    const params = [req.user.company_id, ...values];
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM products p ${where}`, params);
    const [rows] = await pool.query(
      `SELECT p.*, pc.name as category_name FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginate(res, rows, total, page, limit);
  } catch (err) { next(err); }
};

const getProduct = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, pc.name as category_name FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE p.id = ? AND p.company_id = ?`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return error(res, 'Product not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

const updateProduct = async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'unit_price', 'unit', 'category_id', 'tax_rate', 'is_active'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`).join(', ');
    const values = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (!sets) return error(res, 'No valid fields', 400);
    values.push(req.params.id, req.user.company_id);
    await pool.query(`UPDATE products SET ${sets}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.UPDATE, entity: 'product', entityId: req.params.id, req });
    return success(res, {}, 'Product updated');
  } catch (err) { next(err); }
};

const deleteProduct = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM products WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    await audit({ userId: req.user.id, companyId: req.user.company_id, action: AUDIT_ACTIONS.DELETE, entity: 'product', entityId: req.params.id, req });
    return success(res, {}, 'Product deleted');
  } catch (err) { next(err); }
};

// GET /product-categories
const getCategories = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM product_categories WHERE company_id = ? ORDER BY name', [req.user.company_id]);
    return success(res, rows);
  } catch (err) { next(err); }
};

const createCategory = async (req, res, next) => {
  try {
    const id = uuidv4();
    await pool.query(`INSERT INTO product_categories (id, company_id, name, description) VALUES (?, ?, ?, ?)`,
      [id, req.user.company_id, req.body.name, req.body.description || null]);
    return created(res, { id }, 'Category created');
  } catch (err) { next(err); }
};

const updateCategory = async (req, res, next) => {
  try {
    await pool.query(`UPDATE product_categories SET name = ?, description = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [req.body.name, req.body.description || null, req.params.id, req.user.company_id]);
    return success(res, {}, 'Category updated');
  } catch (err) { next(err); }
};

const deleteCategory = async (req, res, next) => {
  try {
    await pool.query('DELETE FROM product_categories WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    return success(res, {}, 'Category deleted');
  } catch (err) { next(err); }
};

const exportProducts = async (req, res, next) => {
  try {
    const { type = 'template' } = req.query;
    if (type === 'template') {
      const buffer = generateTemplate(PRODUCT_HEADERS, 'Products');
      res.setHeader('Content-Disposition', 'attachment; filename=products_template.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
    }
    const [rows] = await pool.query(
      `SELECT p.name, p.description, p.unit_price, p.unit, p.category_id, p.tax_rate FROM products p WHERE p.company_id = ?`,
      [req.user.company_id]
    );
    const buffer = generateExport(rows, 'Products');
    res.setHeader('Content-Disposition', 'attachment; filename=products_export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (err) { next(err); }
};

const importProducts = async (req, res, next) => {
  try {
    if (!req.file) return error(res, 'File is required', 400);
    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return error(res, 'File is empty', 400);
    let inserted = 0, failed = 0, errors = [];
    for (const row of rows) {
      if (!row.name || !row.unit_price) { failed++; errors.push({ row, reason: 'name and unit_price required' }); continue; }
      try {
        await pool.query(
          `INSERT INTO products (id, company_id, name, description, unit_price, unit, category_id, tax_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), req.user.company_id, row.name, row.description || null, row.unit_price, row.unit || null, row.category_id || null, row.tax_rate || 0]
        );
        inserted++;
      } catch (e) { failed++; errors.push({ row, reason: e.message }); }
    }
    return success(res, { inserted, failed, errors }, `Import complete: ${inserted} inserted, ${failed} failed`);
  } catch (err) { next(err); }
};

module.exports = { createProduct, getProducts, getProduct, updateProduct, deleteProduct, getCategories, createCategory, updateCategory, deleteCategory, exportProducts, importProducts };
