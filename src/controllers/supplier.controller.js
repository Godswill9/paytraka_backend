const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error, paginate } = require("../utils/response");
const { getPagination, buildSearch } = require("../utils/pagination");
const {
  parseImportFile,
  generateTemplate,
  generateExport,
  SUPPLIER_HEADERS,
} = require("../utils/importExport");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// POST /suppliers
const createSupplier = async (req, res, next) => {
  try {
    const {
      supplier_type,
      supplier_name,
      contact_person,
      email,
      phone,
      supplier_documents,
      tax_identification_number,
      rc_number,
      address,
      city,
      state,
      country,
      status = "active",
      bank_name,
      account_number,
      account_name,
      payment_method,
      payment_terms,
      vat_number,
      track_vat = 0,
      track_wht = 0,
      attach_docs = 0,
    } = req.body;

    if (!supplier_name) return error(res, "supplier_name is required", 400);

    const id = uuidv4();
    const public_id = uuidv4();

    await pool.query(
      `INSERT INTO suppliers (
        id, public_id, company_id, supplier_type, supplier_name, contact_person, email, phone,
        supplier_documents, tax_identification_number, rc_number, address, city, state, country,
        status, bank_name, account_number, account_name, payment_method, payment_terms,
        vat_number, track_vat, track_wht, attach_docs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        public_id,
        req.user.company_id,
        supplier_type || null,
        supplier_name,
        contact_person || null,
        email || null,
        phone || null,
        supplier_documents ? JSON.stringify(supplier_documents) : null,
        tax_identification_number || null,
        rc_number || null,
        address || null,
        city || null,
        state || null,
        country || null,
        status,
        bank_name || null,
        account_number || null,
        account_name || null,
        payment_method || null,
        payment_terms || null,
        vat_number || null,
        track_vat ? 1 : 0,
        track_wht ? 1 : 0,
        attach_docs ? 1 : 0,
      ],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.CREATE,
      entity: "supplier",
      entityId: id,
      req,
    });
    return created(res, { id, public_id }, "Supplier created");
  } catch (err) {
    next(err);
  }
};

// GET /suppliers
const getSuppliers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { clause, values } = buildSearch(
      ["supplier_name", "email", "phone", "contact_person"],
      req.query.search,
    );

    const filters = [];
    const filterValues = [];

    if (req.query.supplier_type) {
      filters.push("supplier_type = ?");
      filterValues.push(req.query.supplier_type);
    }
    if (req.query.status) {
      filters.push("status = ?");
      filterValues.push(req.query.status);
    }

    const extraClause = filters.length ? filters.join(" AND ") : "";
    const where = `WHERE company_id = ?${clause ? ` AND ${clause}` : ""}${extraClause ? ` AND ${extraClause}` : ""}`;
    const params = [req.user.company_id, ...values, ...filterValues];

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM suppliers ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT * FROM suppliers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /suppliers/:id
const getSupplier = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM suppliers WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Supplier not found", 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// PATCH /suppliers/:id
const updateSupplier = async (req, res, next) => {
  try {
    const allowed = [
      "supplier_type",
      "supplier_name",
      "contact_person",
      "email",
      "phone",
      "supplier_documents",
      "tax_identification_number",
      "rc_number",
      "address",
      "city",
      "state",
      "country",
      "status",
      "bank_name",
      "account_number",
      "account_name",
      "payment_method",
      "payment_terms",
      "vat_number",
      "track_vat",
      "track_wht",
      "attach_docs",
    ];

    const sets = [];
    const values = [];

    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = ?`);
        if (k === "supplier_documents") {
          values.push(JSON.stringify(req.body[k]));
        } else if (["track_vat", "track_wht", "attach_docs"].includes(k)) {
          values.push(req.body[k] ? 1 : 0);
        } else {
          values.push(req.body[k]);
        }
      }
    }

    if (!sets.length) return error(res, "No valid fields to update", 400);

    values.push(req.params.id, req.user.company_id);

    await pool.query(
      `UPDATE suppliers SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      values,
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "supplier",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Supplier updated");
  } catch (err) {
    next(err);
  }
};

// DELETE /suppliers/:id
const deleteSupplier = async (req, res, next) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM suppliers WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (result.affectedRows === 0) return error(res, "Supplier not found", 404);
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.DELETE,
      entity: "supplier",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Supplier deleted");
  } catch (err) {
    next(err);
  }
};

// GET /suppliers/export
const exportSuppliers = async (req, res, next) => {
  try {
    const { type = "template" } = req.query;

    if (type === "template") {
      const buffer = generateTemplate(SUPPLIER_HEADERS, "Suppliers");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=suppliers_template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return res.send(buffer);
    }

    const [rows] = await pool.query(
      `SELECT supplier_type, supplier_name, contact_person, email, phone,
              tax_identification_number, rc_number, vat_number,
              address, city, state, country, status,
              bank_name, account_number, account_name,
              payment_method, payment_terms,
              track_vat, track_wht, attach_docs
       FROM suppliers WHERE company_id = ?`,
      [req.user.company_id],
    );

    const buffer = generateExport(rows, "Suppliers");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=suppliers_export.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.EXPORT,
      entity: "supplier",
      req,
    });
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
};

// POST /suppliers/import
const importSuppliers = async (req, res, next) => {
  try {
    if (!req.file) return error(res, "File is required", 400);

    const rows = parseImportFile(req.file.buffer, req.file.originalname);
    if (!rows.length) return error(res, "File is empty", 400);

    let inserted = 0,
      failed = 0,
      errors = [];

    for (const row of rows) {
      if (!row.supplier_name) {
        failed++;
        errors.push({ row, reason: "supplier_name is required" });
        continue;
      }
      try {
        await pool.query(
          `INSERT INTO suppliers (
            id, public_id, company_id, supplier_type, supplier_name, contact_person, email, phone,
            tax_identification_number, rc_number, address, city, state, country, status,
            bank_name, account_number, account_name, payment_method, payment_terms, vat_number,
            track_vat, track_wht, attach_docs
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            uuidv4(),
            req.user.company_id,
            row.supplier_type || null,
            row.supplier_name,
            row.contact_person || null,
            row.email || null,
            row.phone || null,
            row.tax_identification_number || null,
            row.rc_number || null,
            row.address || null,
            row.city || null,
            row.state || null,
            row.country || null,
            row.status || "active",
            row.bank_name || null,
            row.account_number || null,
            row.account_name || null,
            row.payment_method || null,
            row.payment_terms || null,
            row.vat_number || null,
            row.track_vat ? 1 : 0,
            row.track_wht ? 1 : 0,
            row.attach_docs ? 1 : 0,
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
      entity: "supplier",
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
  createSupplier,
  getSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  exportSuppliers,
  importSuppliers,
};
