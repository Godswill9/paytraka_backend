const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error, paginate } = require("../utils/response");
const { getPagination, buildSearch } = require("../utils/pagination");
const {
  parseImportFile,
  generateTemplate,
  generateExport,
  CUSTOMER_HEADERS,
} = require("../utils/importExport");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// POST /customers
const createCustomer = async (req, res, next) => {
  try {
    const {
      customer_type,
      name,
      email,
      phone1,
      phone2,
      tax_identification_number,
      rc_number,
      vat_number,
      billing_address,
      city,
      state,
      postal_code,
      payment_terms,
      preferred_currency,
      country,
      customer_documents,
      status = "active",
    } = req.body;

    if (!name) return error(res, "name is required", 400);

    const id = uuidv4();
    const public_id = uuidv4();

    await pool.query(
      `INSERT INTO customers (
        id, public_id, company_id, customer_type, name, email, phone1, phone2,
        tax_identification_number, rc_number, vat_number, billing_address,
        city, state, postal_code, payment_terms, preferred_currency, country,
        customer_documents, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        public_id,
        req.user.company_id,
        customer_type || null,
        name,
        email || null,
        phone1 || null,
        phone2 || null,
        tax_identification_number || null,
        rc_number || null,
        vat_number || null,
        billing_address || null,
        city || null,
        state || null,
        postal_code || null,
        payment_terms || null,
        preferred_currency || null,
        country || null,
        customer_documents ? JSON.stringify(customer_documents) : null,
        status,
      ],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.CREATE,
      entity: "customer",
      entityId: id,
      req,
    });
    return created(res, { id, public_id }, "Customer created");
  } catch (err) {
    next(err);
  }
};

// GET /customers
const getCustomers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { clause, values } = buildSearch(
      ["name", "email", "phone1"],
      req.query.search,
    );

    // Optional filters
    const filters = [];
    const filterValues = [];

    if (req.query.customer_type) {
      filters.push("customer_type = ?");
      filterValues.push(req.query.customer_type);
    }
    if (req.query.status) {
      filters.push("status = ?");
      filterValues.push(req.query.status);
    }

    const extraClause = filters.length ? filters.join(" AND ") : "";
    const where = `WHERE company_id = ?${clause ? ` AND ${clause}` : ""}${extraClause ? ` AND ${extraClause}` : ""}`;
    const params = [req.user.company_id, ...values, ...filterValues];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM customers ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /customers/:id
const getCustomer = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM customers WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Customer not found", 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// PATCH /customers/:id
const updateCustomer = async (req, res, next) => {
  try {
    const allowed = [
      "customer_type",
      "name",
      "email",
      "phone1",
      "phone2",
      "tax_identification_number",
      "rc_number",
      "vat_number",
      "billing_address",
      "city",
      "state",
      "postal_code",
      "payment_terms",
      "preferred_currency",
      "country",
      "customer_documents",
      "status",
    ];

    const sets = [];
    const values = [];

    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = ?`);
        values.push(
          k === "customer_documents"
            ? JSON.stringify(req.body[k])
            : req.body[k],
        );
      }
    }

    if (!sets.length) return error(res, "No valid fields to update", 400);

    values.push(req.params.id, req.user.company_id);

    await pool.query(
      `UPDATE customers SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      values,
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "customer",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Customer updated");
  } catch (err) {
    next(err);
  }
};

// DELETE /customers/:id
const deleteCustomer = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM customers WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (result.affectedRows === 0) return error(res, "Customer not found", 404);
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.DELETE,
      entity: "customer",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Customer deleted");
  } catch (err) {
    next(err);
  }
};

// GET /customers/export
const exportCustomers = async (req, res, next) => {
  try {
    const { type = "template" } = req.query;

    if (type === "template") {
      const buffer = generateTemplate(CUSTOMER_HEADERS, "Customers");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=customers_template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return res.send(buffer);
    }

    const [rows] = await pool.query(
      `SELECT customer_type, name, email, phone1, phone2, tax_identification_number,
              rc_number, vat_number, billing_address, city, state, postal_code,
              payment_terms, preferred_currency, country, status
       FROM customers WHERE company_id = ?`,
      [req.user.company_id],
    );

    const buffer = generateExport(rows, "Customers");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=customers_export.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.EXPORT,
      entity: "customer",
      req,
    });
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

// POST /customers/import
const importCustomers = async (req, res, next) => {
  try {
    if (!req.file) return error(res, "File is required", 400);

    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return error(res, "File is empty", 400);

    let inserted = 0,
      failed = 0,
      errors = [];

    for (const row of rows) {
      if (!row.name) {
        failed++;
        errors.push({ row, reason: "name is required" });
        continue;
      }
      try {
        await pool.query(
          `INSERT INTO customers (
            id, public_id, company_id, customer_type, name, email, phone1, phone2,
            tax_identification_number, rc_number, vat_number, billing_address,
            city, state, postal_code, payment_terms, preferred_currency, country, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            uuidv4(),
            req.user.company_id,
            row.customer_type || null,
            row.name,
            row.email || null,
            row.phone1 || null,
            row.phone2 || null,
            row.tax_identification_number || null,
            row.rc_number || null,
            row.vat_number || null,
            row.billing_address || null,
            row.city || null,
            row.state || null,
            row.postal_code || null,
            row.payment_terms || null,
            row.preferred_currency || null,
            row.country || null,
            row.status || "active",
          ],
        );
        inserted++;
      } catch (e) {
        failed++;
        errors.push({ row, reason: e.message });
      }
    }

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.IMPORT,
      entity: "customer",
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
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  exportCustomers,
  importCustomers,
};
