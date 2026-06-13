const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error, paginate } = require("../utils/response");
const { getPagination, buildSearch } = require("../utils/pagination");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// Invoice types that MUST reference an existing invoice
const REFERENCING_TYPES = ["credit_note", "debit_note"];

// Invoice number prefix per type
const TYPE_PREFIX = {
  standard_invoice: "INV",
  proforma_invoice: "PRO",
  credit_note: "CRN",
  debit_note: "DBN",
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const generateInvoiceNumber = async (companyId, invoice_type) => {
  const year = new Date().getFullYear();
  const [[{ count }]] = await pool.query(
    `SELECT COUNT(*) as count FROM sales_invoices
     WHERE company_id = ? AND invoice_type = ? AND YEAR(created_at) = ?`,
    [companyId, invoice_type, year],
  );
  const seq = String(count + 1).padStart(4, "0");

  let prefix = TYPE_PREFIX[invoice_type] || "INV";
  if (invoice_type === "standard_invoice") {
    const [settings] = await pool.query(
      "SELECT invoice_prefix FROM company_settings WHERE company_id = ?",
      [companyId],
    );
    prefix = settings[0]?.invoice_prefix || "INV";
  }

  return `${prefix}-${year}-${seq}`;
};

const processLineItems = (line_items) => {
  let subtotal = 0;
  let tax_amount = 0;

  const processed = line_items.map((item) => {
    const qty = parseFloat(item.quantity) || 0;
    const unit_price = parseFloat(item.unit_price) || 0;
    const item_discount = parseFloat(item.discount_amount) || 0;
    const tax_rate = parseFloat(item.tax_rate) || 0;

    const lineBase = qty * unit_price - item_discount;
    const lineTax = lineBase * (tax_rate / 100);
    const line_total = lineBase + lineTax;

    subtotal += qty * unit_price;
    tax_amount += lineTax;

    return {
      ...item,
      qty,
      unit_price,
      item_discount,
      tax_rate,
      lineTax,
      line_total,
    };
  });

  return { processed, subtotal, tax_amount };
};

const insertLineItems = async (conn, invoiceId, processedItems) => {
  for (const item of processedItems) {
    await conn.query(
      `INSERT INTO sales_invoice_lineitems (
        id, invoice_id, product_id, item_name, product_category,
        description, quantity, unit_price, discount_amount,
        tax_rate, tax_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        invoiceId,
        item.product_id || null,
        item.item_name || item.description || null,
        item.product_category || null,
        item.description || null,
        item.qty,
        item.unit_price,
        item.item_discount,
        item.tax_rate,
        item.lineTax,
        item.line_total,
      ],
    );
  }
};

// Validate + fetch the referenced invoice for CN/DN
const validateRelatedInvoice = async (
  companyId,
  related_invoice_id,
  customer_id,
) => {
  const [relatedRows] = await pool.query(
    `SELECT id, status, invoice_type, customer_id, total_amount, balance_due
     FROM sales_invoices WHERE id = ? AND company_id = ?`,
    [related_invoice_id, companyId],
  );
  if (!relatedRows.length) return { err: "Referenced invoice not found" };

  const related = relatedRows[0];

  if (REFERENCING_TYPES.includes(related.invoice_type)) {
    return {
      err: "Cannot create a credit/debit note against another credit/debit note",
    };
  }
  if (["draft", "cancelled"].includes(related.status)) {
    return { err: "Referenced invoice must be in sent or paid status" };
  }
  if (related.customer_id !== customer_id) {
    return { err: "customer_id must match the referenced invoice" };
  }

  return { related };
};

// ─────────────────────────────────────────────────────────
// POST /sales-invoices
// Handles: standard_invoice | proforma_invoice | credit_note | debit_note
// ─────────────────────────────────────────────────────────

// this creates invoices as draft
const createInvoice = async (req, res, next) => {
  try {
    const {
      customer_id,
      invoice_type = "standard_invoice",
      related_invoice_id,
      issue_date,
      due_date,
      currency = "NGN",
      notes,
      terms,
      line_items,
      discount_amount = 0,
      send_to_customer = 0,
      send_to_firs = 0,
    } = req.body;

    if (!customer_id) return error(res, "customer_id is required", 400);
    if (!line_items?.length)
      return error(res, "At least one line item is required", 400);

    const validTypes = Object.keys(TYPE_PREFIX);
    if (!validTypes.includes(invoice_type)) {
      return error(
        res,
        `Invalid invoice_type. Must be one of: ${validTypes.join(", ")}`,
        400,
      );
    }

    // CN and DN must reference a valid sent/paid invoice from the same customer
    if (REFERENCING_TYPES.includes(invoice_type)) {
      if (!related_invoice_id) {
        return error(
          res,
          `${invoice_type} must reference an existing invoice via related_invoice_id`,
          400,
        );
      }
      const { err } = await validateRelatedInvoice(
        req.user.company_id,
        related_invoice_id,
        customer_id,
      );
      if (err) return error(res, err, 400);
    }

    // Fetch customer
    const [[customer]] = await pool.query(
      "SELECT name FROM customers WHERE id = ? AND company_id = ?",
      [customer_id, req.user.company_id],
    );
    if (!customer) return error(res, "Customer not found", 404);

    const [[company]] = await pool.query(
      "SELECT company_name FROM companies WHERE id = ?",
      [req.user.company_id],
    );

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const id = uuidv4();
      const public_id = uuidv4();
      const invoice_number = await generateInvoiceNumber(
        req.user.company_id,
        invoice_type,
      );

      const { processed, subtotal, tax_amount } = processLineItems(line_items);
      const invoiceDiscount = parseFloat(discount_amount) || 0;
      const total_amount = subtotal - invoiceDiscount + tax_amount;

      await conn.query(
        `INSERT INTO sales_invoices (
          id, public_id, company_id, company_name,
          customer_id, customer_name, created_by,
          invoice_number, invoice_type, related_invoice_id,
          issue_date, due_date, currency,
          subtotal, discount_amount, tax_amount, total_amount,
          amount_paid, balance_due,
          status, payment_status,
          send_to_customer, send_to_firs,
          notes, terms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', 'unpaid', ?, ?, ?, ?)`,
        [
          id,
          public_id,
          req.user.company_id,
          company?.company_name || null,
          customer_id,
          customer.name,
          req.user.id,
          invoice_number,
          invoice_type,
          related_invoice_id || null,
          issue_date,
          due_date,
          currency,
          subtotal,
          invoiceDiscount,
          tax_amount,
          total_amount,
          total_amount,
          send_to_customer ? 1 : 0,
          send_to_firs ? 1 : 0,
          notes || null,
          terms || null,
        ],
      );

      await insertLineItems(conn, id, processed);

      await conn.commit();
      conn.release();

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.CREATE,
        entity: "sales_invoice",
        entityId: id,
        req,
      });
      return created(
        res,
        { id, public_id, invoice_number },
        `${invoice_type.replace(/_/g, " ")} created`,
      );
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (err) {
    next(err);
  }
};

// POST /sales-invoices/:id/post
const postInvoice = async (req, res, next) => {
  try {
    const [[invoice]] = await pool.query(
      "SELECT status, invoice_type, related_invoice_id FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!invoice) return error(res, "Invoice not found", 404);
    if (invoice.status !== "draft")
      return error(res, "Only draft invoices can be posted", 400);

    if (
      REFERENCING_TYPES.includes(invoice.invoice_type) &&
      !invoice.related_invoice_id
    ) {
      return error(
        res,
        `${invoice.invoice_type} must reference an invoice before it can be posted`,
        400,
      );
    }

    await pool.query(
      `UPDATE sales_invoices SET status = 'posted', updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "sales_invoice",
      entityId: req.params.id,
      req,
    });
    return success(
      res,
      {},
      "Invoice posted. It is now locked and ready to send.",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /sales-invoices
// ─────────────────────────────────────────────────────────
const getInvoices = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, payment_status, customer_id, invoice_type } = req.query;
    const { clause, values } = buildSearch(
      ["si.invoice_number", "si.customer_name"],
      req.query.search,
    );

    let where = "WHERE si.company_id = ?";
    const params = [req.user.company_id];

    if (status) {
      where += " AND si.status = ?";
      params.push(status);
    }
    if (payment_status) {
      where += " AND si.payment_status = ?";
      params.push(payment_status);
    }
    if (customer_id) {
      where += " AND si.customer_id = ?";
      params.push(customer_id);
    }
    if (invoice_type) {
      where += " AND si.invoice_type = ?";
      params.push(invoice_type);
    }
    if (clause) {
      where += ` AND ${clause}`;
      params.push(...values);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM sales_invoices si ${where}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT si.* FROM sales_invoices si ${where} ORDER BY si.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /sales-invoices/:id
// ─────────────────────────────────────────────────────────
const getInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Invoice not found", 404);

    const invoice = rows[0];

    const [lineitems] = await pool.query(
      `SELECT sil.*, p.name as product_name FROM sales_invoice_lineitems sil
       LEFT JOIN products p ON p.id = sil.product_id
       WHERE sil.invoice_id = ?`,
      [req.params.id],
    );

    // Attach referenced invoice summary for CN/DN
    let related_invoice = null;
    if (invoice.related_invoice_id) {
      const [[rel]] = await pool.query(
        `SELECT id, invoice_number, invoice_type, status, payment_status,
                total_amount, amount_paid, balance_due
         FROM sales_invoices WHERE id = ?`,
        [invoice.related_invoice_id],
      );
      related_invoice = rel || null;
    }

    // Attach all CNs/DNs that reference THIS invoice
    const [linked_notes] = await pool.query(
      `SELECT id, invoice_number, invoice_type, status, total_amount
       FROM sales_invoices
       WHERE related_invoice_id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id],
    );

    return success(res, {
      ...invoice,
      line_items: lineitems,
      related_invoice,
      linked_notes,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /sales-invoices/:id  (draft only)
// ─────────────────────────────────────────────────────────

const updateInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query(
      "SELECT status, invoice_type FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!existing.length) return error(res, "Invoice not found", 404);
    if (existing[0].status !== "draft")
      return error(res, "Only draft invoices can be edited", 400);

    const {
      customer_id,
      issue_date,
      due_date,
      currency,
      notes,
      terms,
      discount_amount,
      send_to_customer,
      send_to_firs,
      related_invoice_id,
      line_items,
    } = req.body;

    // Validate related_invoice_id change for CN/DN
    if (
      related_invoice_id &&
      REFERENCING_TYPES.includes(existing[0].invoice_type)
    ) {
      const { err } = await validateRelatedInvoice(
        req.user.company_id,
        related_invoice_id,
        customer_id,
      );
      if (err) return error(res, err, 400);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const sets = [];
      const values = [];

      const scalar = [
        "customer_id",
        "issue_date",
        "due_date",
        "currency",
        "notes",
        "terms",
        "related_invoice_id",
      ];
      for (const k of scalar) {
        if (req.body[k] !== undefined) {
          sets.push(`${k} = ?`);
          values.push(req.body[k]);
        }
      }

      if (send_to_customer !== undefined) {
        sets.push("send_to_customer = ?");
        values.push(send_to_customer ? 1 : 0);
      }
      if (send_to_firs !== undefined) {
        sets.push("send_to_firs = ?");
        values.push(send_to_firs ? 1 : 0);
      }

      if (customer_id) {
        const [[cust]] = await conn.query(
          "SELECT name FROM customers WHERE id = ? AND company_id = ?",
          [customer_id, req.user.company_id],
        );
        if (!cust) {
          await conn.rollback();
          conn.release();
          return error(res, "Customer not found", 404);
        }
        sets.push("customer_name = ?");
        values.push(cust.name);
      }

      if (line_items?.length) {
        const { processed, subtotal, tax_amount } =
          processLineItems(line_items);
        const invoiceDiscount = parseFloat(discount_amount) || 0;
        const total_amount = subtotal - invoiceDiscount + tax_amount;

        sets.push(
          "subtotal = ?",
          "discount_amount = ?",
          "tax_amount = ?",
          "total_amount = ?",
          "balance_due = ?",
        );
        values.push(
          subtotal,
          invoiceDiscount,
          tax_amount,
          total_amount,
          total_amount,
        );

        await conn.query(
          "DELETE FROM sales_invoice_lineitems WHERE invoice_id = ?",
          [req.params.id],
        );
        await insertLineItems(conn, req.params.id, processed);
      }

      if (!sets.length) {
        await conn.rollback();
        conn.release();
        return error(res, "No valid fields to update", 400);
      }

      values.push(req.params.id, req.user.company_id);
      await conn.query(
        `UPDATE sales_invoices SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
        values,
      );

      await conn.commit();
      conn.release();

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.UPDATE,
        entity: "sales_invoice",
        entityId: req.params.id,
        req,
      });
      return success(res, {}, "Invoice updated");
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// DELETE /sales-invoices/:id  (draft only)
// ─────────────────────────────────────────────────────────
const deleteInvoice = async (req, res, next) => {
  try {
    const [existing] = await pool.query(
      "SELECT status FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!existing.length) return error(res, "Invoice not found", 404);
    if (existing[0].status !== "draft")
      return error(res, "Only draft invoices can be deleted", 400);

    await pool.query(
      "DELETE FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.DELETE,
      entity: "sales_invoice",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Invoice deleted");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /sales-invoices/:id/send
// Locks invoice from editing. CN/DN must still have related_invoice_id.
// ─────────────────────────────────────────────────────────
const sendInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Invoice not found", 404);

    const invoice = rows[0];

    if (invoice.status === "cancelled")
      return error(res, "Cannot send a cancelled invoice", 400);
    // to this:
    if (!["draft", "posted"].includes(invoice.status))
      return error(res, "Invoice has already been sent", 400);
    if (
      REFERENCING_TYPES.includes(invoice.invoice_type) &&
      !invoice.related_invoice_id
    ) {
      return error(
        res,
        `${invoice.invoice_type} must reference an invoice before it can be sent`,
        400,
      );
    }

    // TODO: send email to customer

    await pool.query(
      `UPDATE sales_invoices
       SET status = 'sent', payment_status = 'unpaid', sent_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [req.params.id],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "sales_invoice",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Invoice sent to customer");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /sales-invoices/:id/cancel
// ─────────────────────────────────────────────────────────
const cancelInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT status FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Invoice not found", 404);
    // if (rows[0].status === "paid")
    //   return error(res, "Cannot cancel a paid invoice", 400);
    // if (rows[0].status === "cancelled")
    //   return error(res, "Invoice is already cancelled", 400);

    if (!["draft", "posted", "sent"].includes(rows[0].status)) {
      return error(res, "Invoice cannot be cancelled at this stage", 400);
    }
    await pool.query(
      `UPDATE sales_invoices SET status = 'cancelled', updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [req.params.id, req.user.company_id],
    );
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "sales_invoice",
      entityId: req.params.id,
      req,
    });
    return success(res, {}, "Invoice cancelled");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /sales-invoices/:id/convert-to-invoice
// Convert a proforma_invoice → standard_invoice
// ─────────────────────────────────────────────────────────
const convertProformaToInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Invoice not found", 404);

    const proforma = rows[0];
    if (proforma.invoice_type !== "proforma_invoice")
      return error(res, "Only proforma invoices can be converted", 400);
    if (proforma.status === "cancelled")
      return error(res, "Cannot convert a cancelled proforma", 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const newId = uuidv4();
      const new_public_id = uuidv4();
      const invoice_number = await generateInvoiceNumber(
        req.user.company_id,
        "standard_invoice",
      );

      await conn.query(
        `INSERT INTO sales_invoices (
          id, public_id, company_id, company_name,
          customer_id, customer_name, created_by,
          invoice_number, invoice_type, related_invoice_id,
          issue_date, due_date, currency,
          subtotal, discount_amount, tax_amount, total_amount,
          amount_paid, balance_due,
          status, payment_status,
          send_to_customer, send_to_firs,
          notes, terms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'standard_invoice', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', 'unpaid', ?, ?, ?, ?)`,
        [
          newId,
          new_public_id,
          proforma.company_id,
          proforma.company_name,
          proforma.customer_id,
          proforma.customer_name,
          req.user.id,
          invoice_number,
          proforma.id, // ← related_invoice_id = proforma's id
          proforma.issue_date,
          proforma.due_date,
          proforma.currency,
          proforma.subtotal,
          proforma.discount_amount,
          proforma.tax_amount,
          proforma.total_amount,
          proforma.total_amount,
          proforma.send_to_customer,
          proforma.send_to_firs,
          proforma.notes,
          proforma.terms,
        ],
      );

      // Copy line items
      const [items] = await conn.query(
        "SELECT * FROM sales_invoice_lineitems WHERE invoice_id = ?",
        [proforma.id],
      );
      for (const item of items) {
        await conn.query(
          `INSERT INTO sales_invoice_lineitems (
            id, invoice_id, product_id, item_name, product_category,
            description, quantity, unit_price, discount_amount,
            tax_rate, tax_amount, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            newId,
            item.product_id,
            item.item_name,
            item.product_category,
            item.description,
            item.quantity,
            item.unit_price,
            item.discount_amount,
            item.tax_rate,
            item.tax_amount,
            item.line_total,
          ],
        );
      }

      await conn.commit();
      conn.release();

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.CREATE,
        entity: "sales_invoice",
        entityId: newId,
        req,
      });
      return created(
        res,
        { id: newId, public_id: new_public_id, invoice_number },
        "Proforma converted to standard invoice",
      );
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /sales-invoices/:id/lineitems
// ─────────────────────────────────────────────────────────
const getLineitems = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT sil.*, p.name as product_name FROM sales_invoice_lineitems sil
       LEFT JOIN products p ON p.id = sil.product_id
       WHERE sil.invoice_id = ?`,
      [req.params.id],
    );
    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
  cancelInvoice,
  convertProformaToInvoice,
  getLineitems,
  postInvoice,
};
