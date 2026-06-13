const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error, paginate } = require("../utils/response");
const { getPagination, buildSearch } = require("../utils/pagination");
const {
  parseImportFile,
  generateTemplate,
  generateExport,
  PRODUCT_HEADERS,
} = require("../utils/importExport");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// ── Helper: resolve category_name from category_id ───────
const resolveCategoryName = async (categoryId, companyId) => {
  if (!categoryId) return null;
  const [[cat]] = await pool.query(
    "SELECT name FROM product_categories WHERE id = ? AND company_id = ?",
    [categoryId, companyId],
  );
  return cat?.name || null;
};

// POST /products
const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      sku,
      description,
      product_type = "product",
      unit_price,
      cost_price,
      tax_rate = 0,
      tax_categories,
      currency,
      stock_quantity = 0,
      track_inventory = 0,
      status = "active",
      category_id,
    } = req.body;

    if (!name) return error(res, "name is required", 400);
    if (!unit_price) return error(res, "unit_price is required", 400);

    if (!["product", "service"].includes(product_type)) {
      return error(res, "product_type must be 'product' or 'service'", 400);
    }

    // Validate category belongs to this company and get its name
    let category_name = null;
    if (category_id) {
      category_name = await resolveCategoryName(
        category_id,
        req.user.company_id,
      );
      if (!category_name) return error(res, "Category not found", 404);
    }

    const id = uuidv4();
    const public_id = uuidv4();
    await pool.query(
      `INSERT INTO products (
        id, public_id, company_id, name, sku, description, product_type,
        unit_price, cost_price, tax_rate, tax_categories, currency,
        stock_quantity, track_inventory, status, category_id, category_name
      ) VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        public_id,
        req.user.company_id,
        name,
        sku || null,
        description || null,
        product_type,
        unit_price,
        cost_price || null,
        tax_rate,
        tax_categories ? JSON.stringify(tax_categories) : null,
        currency || null,
        stock_quantity,
        track_inventory ? 1 : 0,
        status,
        category_id || null,
        category_name,
      ],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.CREATE,
      entity: "product",
      entityId: id,
      req,
    });
    return created(res, { id }, "Product created");
  } catch (err) {
    next(err);
  }
};

// GET /products
const getProducts = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { clause, values } = buildSearch(
      ["p.name", "p.description", "p.sku"],
      req.query.search,
    );

    const filters = [];
    const filterValues = [];

    if (req.query.product_type) {
      filters.push("p.product_type = ?");
      filterValues.push(req.query.product_type);
    }
    if (req.query.status) {
      filters.push("p.status = ?");
      filterValues.push(req.query.status);
    }
    if (req.query.category_id) {
      filters.push("p.category_id = ?");
      filterValues.push(req.query.category_id);
    }

    const where = `WHERE p.company_id = ?${clause ? ` AND ${clause}` : ""}${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
    const params = [req.user.company_id, ...values, ...filterValues];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM products p ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT p.*, pc.name as category_name FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /products/:id
const getProduct = async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      `SELECT p.*, pc.name as category_name FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE p.id = ? AND p.company_id = ?`,
      [req.params.id, req.user.company_id],
    );
    if (!row) return error(res, "Product not found", 404);
    return success(res, row);
  } catch (err) {
    next(err);
  }
};

// PATCH /products/:id
const updateProduct = async (req, res, next) => {
  try {
    const allowed = [
      "name",
      "sku",
      "description",
      "product_type",
      "unit_price",
      "cost_price",
      "tax_rate",
      "tax_categories",
      "currency",
      "stock_quantity",
      "track_inventory",
      "status",
      "category_id",
    ];

    const sets = [];
    const values = [];

    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      sets.push(`${k} = ?`);
      if (k === "tax_categories") values.push(JSON.stringify(req.body[k]));
      else if (k === "track_inventory") values.push(req.body[k] ? 1 : 0);
      else values.push(req.body[k]);
    }

    if (!sets.length) return error(res, "No valid fields to update", 400);

    // Sync category_name when category_id changes
    if (req.body.category_id !== undefined) {
      const category_name = await resolveCategoryName(
        req.body.category_id,
        req.user.company_id,
      );
      if (req.body.category_id && !category_name)
        return error(res, "Category not found", 404);
      sets.push("category_name = ?");
      values.push(category_name);
    }

    values.push(req.params.id, req.user.company_id);
    await pool.query(
      `UPDATE products SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      values,
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "product",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Product updated");
  } catch (err) {
    next(err);
  }
};

// DELETE /products/:id
const deleteProduct = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM products WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (result.affectedRows === 0) return error(res, "Product not found", 404);
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.DELETE,
      entity: "product",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Product deleted");
  } catch (err) {
    next(err);
  }
};

// ── CATEGORIES ────────────────────────────────────────────

// GET /product-categories
const getCategories = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM product_categories WHERE company_id = ? ORDER BY name",
      [req.user.company_id],
    );
    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

// GET /product-categories/:id
const getCategory = async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      "SELECT * FROM product_categories WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!row) return error(res, "Category not found", 404);
    return success(res, row);
  } catch (err) {
    next(err);
  }
};

// POST /product-categories
const createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) return error(res, "name is required", 400);

    const id = uuidv4();
    await pool.query(
      `INSERT INTO product_categories (id, company_id, name, description) VALUES (?, ?, ?, ?)`,
      [id, req.user.company_id, name, description || null],
    );
    return created(res, { id }, "Category created");
  } catch (err) {
    next(err);
  }
};

// PATCH /product-categories/:id
const updateCategory = async (req, res, next) => {
  try {
    const sets = [];
    const values = [];

    if (req.body.name !== undefined) {
      sets.push("name = ?");
      values.push(req.body.name);
    }
    if (req.body.description !== undefined) {
      sets.push("description = ?");
      values.push(req.body.description);
    }

    if (!sets.length) return error(res, "No valid fields to update", 400);

    values.push(req.params.id, req.user.company_id);
    await pool.query(
      `UPDATE product_categories SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      values,
    );
    return success(res, {}, "Category updated");
  } catch (err) {
    next(err);
  }
};

// DELETE /product-categories/:id
const deleteCategory = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM product_categories WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (result.affectedRows === 0) return error(res, "Category not found", 404);
    return success(res, {}, "Category deleted");
  } catch (err) {
    next(err);
  }
};

// ── IMPORT / EXPORT ───────────────────────────────────────

// GET /products/export
const exportProducts = async (req, res, next) => {
  try {
    const { type = "template" } = req.query;

    if (type === "template") {
      const buffer = generateTemplate(PRODUCT_HEADERS, "Products");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=products_template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return res.send(buffer);
    }

    const [rows] = await pool.query(
      `SELECT name, sku, description, product_type, unit_price, cost_price,
              tax_rate, currency, stock_quantity, track_inventory, status, category_name
       FROM products WHERE company_id = ?`,
      [req.user.company_id],
    );
    const buffer = generateExport(rows, "Products");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=products_export.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.EXPORT,
      entity: "product",
      req,
    });
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

// POST /products/import
const importProducts = async (req, res, next) => {
  try {
    if (!req.file) return error(res, "File is required", 400);

    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return error(res, "File is empty", 400);

    let inserted = 0,
      failed = 0,
      errors = [];

    for (const row of rows) {
      if (!row.name || !row.unit_price) {
        failed++;
        errors.push({ row, reason: "name and unit_price are required" });
        continue;
      }
      try {
        // Resolve category_name if category_id provided in import
        const category_name = row.category_id
          ? await resolveCategoryName(row.category_id, req.user.company_id)
          : row.category_name || null;

        await pool.query(
          `INSERT INTO products (
            id, company_id, name, sku, description, product_type,
            unit_price, cost_price, tax_rate, currency,
            stock_quantity, track_inventory, status, category_id, category_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            req.user.company_id,
            row.name,
            row.sku || null,
            row.description || null,
            row.product_type || "product",
            row.unit_price,
            row.cost_price || null,
            row.tax_rate || 0,
            row.currency || null,
            row.stock_quantity || 0,
            row.track_inventory ? 1 : 0,
            row.status || "active",
            row.category_id || null,
            category_name,
          ],
        );
        inserted++;
      } catch (e) {
        failed++;
        errors.push({ row, reason: e.message });
      }
    }

    audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.IMPORT,
      entity: "product",
      details: { inserted, failed },
      req,
    });
    return success(
      res,
      { inserted, failed, errors },
      `Import complete: ${inserted} inserted, ${failed} failed`,
    );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  exportProducts,
  importProducts,
};
