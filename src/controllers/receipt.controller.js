const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error, paginate } = require("../utils/response");
const { getPagination } = require("../utils/pagination");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

// Generate receipt number: RCP-2026-0001
const generateReceiptNumber = async (companyId) => {
  const year = new Date().getFullYear();
  const [[{ count }]] = await pool.query(
    `SELECT COUNT(*) as count FROM receipts WHERE company_id = ? AND YEAR(created_at) = ?`,
    [companyId, year],
  );
  const seq = String(count + 1).padStart(4, "0");
  return `RCP-${year}-${seq}`;
};

// Check if invoice is fully paid (based on receipts) and update status accordingly
const syncInvoicePaymentStatus = async (conn, invoiceId) => {
  const [[inv]] = await conn.query(
    "SELECT total, status FROM sales_invoices WHERE id = ?",
    [invoiceId],
  );
  if (!inv) return;

  const [[{ paid }]] = await conn.query(
    `SELECT COALESCE(SUM(amount_paid), 0) as paid FROM receipts WHERE sales_invoice_id = ?`,
    [invoiceId],
  );

  if (paid >= inv.total && inv.status !== "paid") {
    await conn.query(
      `UPDATE sales_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [invoiceId],
    );
    return { fully_paid: true, amount_paid: paid, total: inv.total };
  }

  if (paid > 0 && paid < inv.total && inv.status === "draft") {
    // Partial payment — move from draft to sent so it shows as outstanding
    await conn.query(
      `UPDATE sales_invoices SET status = 'sent', updated_at = NOW() WHERE id = ? AND status = 'draft'`,
      [invoiceId],
    );
  }

  return { fully_paid: false, amount_paid: paid, total: inv.total };
};

// Fetch company snapshot fields used to denormalize onto receipts
const getCompanySnapshot = async (conn, companyId) => {
  const [[company]] = await conn.query(
    `SELECT company_name, bank_name, account_number FROM companies WHERE id = ?`,
    [companyId],
  );
  return {
    company_name: company?.company_name || null,
    bank_name: company?.bank_name || null,
    bank_account_number: company?.account_number || null,
  };
};

// ─────────────────────────────────────────────────────────
// POST /receipts
// Manually create a receipt tied to an invoice payment
// ─────────────────────────────────────────────────────────
const createReceipt = async (req, res, next) => {
  try {
    const {
      sales_invoice_id,
      amount_paid,
      payment_method,
      payment_date,
      currency,
      note,
    } = req.body;

    if (!sales_invoice_id || !amount_paid || !payment_date) {
      return error(
        res,
        "sales_invoice_id, amount_paid and payment_date are required",
        400,
      );
    }

    // Verify invoice belongs to this company
    const [invoices] = await pool.query(
      `SELECT si.*, c.id as customer_id, c.name as customer_name FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [sales_invoice_id, req.user.company_id],
    );
    if (!invoices.length) return error(res, "Invoice not found", 404);

    const invoice = invoices[0];
    if (invoice.status === "cancelled") {
      return error(res, "Cannot issue receipt for a cancelled invoice", 400);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const { company_name, bank_name, bank_account_number } =
        await getCompanySnapshot(conn, req.user.company_id);

      // Create receipt
      const receiptId = uuidv4();
      const receiptNumber = await generateReceiptNumber(req.user.company_id);

      await conn.query(
        `INSERT INTO receipts (id, receipt_number, company_id, company_name, sales_invoice_id, customer_id,
          customer_name, payment_id, amount_paid, payment_method, payment_date, bank_account_number,
          bank_name, currency, note, issued_by, is_auto_generated, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          receiptId,
          receiptNumber,
          req.user.company_id,
          company_name,
          sales_invoice_id,
          invoice.customer_id || null,
          invoice.customer_name || null,
          null, // payment_id (no separate payment record anymore)
          amount_paid,
          payment_method || "manual",
          payment_date,
          bank_account_number,
          bank_name,
          currency || "NGN",
          note || null,
          req.user.id,
        ],
      );

      // Sync invoice status
      const paymentStatus = await syncInvoicePaymentStatus(
        conn,
        sales_invoice_id,
      );

      await conn.commit();
      conn.release();

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.CREATE,
        entity: "receipt",
        entityId: receiptId,
        req,
      });

      return created(
        res,
        {
          id: receiptId,
          receipt_number: receiptNumber,
          invoice_fully_paid: paymentStatus?.fully_paid || false,
        },
        "Receipt created successfully",
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
// Internal: Auto-generate receipt from Paystack payment link success
// Called by the Paystack webhook/callback — not a public route
// ─────────────────────────────────────────────────────────
const autoGenerateReceiptFromPaystack = async ({
  companyId,
  invoiceId,
  amountPaid,
  paystackRef,
  currency = "NGN",
}) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Prevent duplicate receipt for same Paystack ref
    const [existing] = await conn.query(
      "SELECT id FROM receipts WHERE payment_link_ref = ?",
      [paystackRef],
    );
    if (existing.length) {
      conn.release();
      return {
        skipped: true,
        reason: "Receipt already exists for this reference",
      };
    }

    // Fetch invoice
    const [[invoice]] = await conn.query(
      `SELECT si.*, c.name as customer_name FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [invoiceId, companyId],
    );
    if (!invoice) {
      conn.release();
      return { skipped: true, reason: "Invoice not found" };
    }

    const { company_name, bank_name, bank_account_number } =
      await getCompanySnapshot(conn, companyId);

    const paymentDate = new Date().toISOString().split("T")[0];

    // Create receipt
    const receiptId = uuidv4();
    const receiptNumber = await generateReceiptNumber(companyId);

    await conn.query(
      `INSERT INTO receipts (id, receipt_number, company_id, company_name, sales_invoice_id, customer_id,
        customer_name, payment_link_ref, amount_paid, payment_method, payment_date, bank_account_number,
        bank_name, currency, is_auto_generated, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paystack', ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        receiptId,
        receiptNumber,
        companyId,
        company_name,
        invoiceId,
        invoice.customer_id || null,
        invoice.customer_name || null,
        paystackRef,
        amountPaid,
        paymentDate,
        bank_account_number,
        bank_name,
        currency,
      ],
    );

    // Sync invoice paid status
    const paymentStatus = await syncInvoicePaymentStatus(conn, invoiceId);

    await conn.commit();
    conn.release();

    return {
      skipped: false,
      receiptId,
      receiptNumber,
      invoice_fully_paid: paymentStatus?.fully_paid || false,
    };
  } catch (e) {
    await conn.rollback();
    conn.release();
    throw e;
  }
};

// ─────────────────────────────────────────────────────────
// GET /receipts
// All receipts for company (paginated, filterable)
// ─────────────────────────────────────────────────────────
const getReceipts = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { invoice_id, customer_id, from_date, to_date } = req.query;

    let where = "WHERE r.company_id = ?";
    const params = [req.user.company_id];

    if (invoice_id) {
      where += " AND r.sales_invoice_id = ?";
      params.push(invoice_id);
    }
    if (customer_id) {
      where += " AND r.customer_id = ?";
      params.push(customer_id);
    }
    if (from_date) {
      where += " AND r.payment_date >= ?";
      params.push(from_date);
    }
    if (to_date) {
      where += " AND r.payment_date <= ?";
      params.push(to_date);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM receipts r ${where}`,
      params,
    );

    const [rows] = await pool.query(
      `SELECT r.*,
              si.invoice_number,
              si.total as invoice_total,
              si.status as invoice_status
       FROM receipts r
       LEFT JOIN sales_invoices si ON si.id = r.sales_invoice_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return paginate(res, rows, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /receipts/:id
// Single receipt with full detail
// ─────────────────────────────────────────────────────────
const getReceipt = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*,
              si.invoice_number, si.issue_date, si.due_date,
              si.subtotal, si.tax_total, si.total as invoice_total, si.status as invoice_status,
              c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
              comp.trading_name, comp.logo_url,
              comp.address as company_address, comp.city, comp.state,
              comp.tax_identification_number, comp.rc_number, comp.account_name
       FROM receipts r
       LEFT JOIN sales_invoices si ON si.id = r.sales_invoice_id
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN companies comp ON comp.id = r.company_id
       WHERE r.id = ? AND r.company_id = ?`,
      [req.params.id, req.user.company_id],
    );

    if (!rows.length) return error(res, "Receipt not found", 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /receipts/invoice/:invoiceId
// All receipts for a specific invoice
// ─────────────────────────────────────────────────────────
const getReceiptsByInvoice = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.* FROM receipts r
       WHERE r.sales_invoice_id = ? AND r.company_id = ?
       ORDER BY r.created_at ASC`,
      [req.params.invoiceId, req.user.company_id],
    );

    // Also return payment summary
    const [[{ total_paid }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total_paid FROM receipts
       WHERE sales_invoice_id = ? AND company_id = ?`,
      [req.params.invoiceId, req.user.company_id],
    );

    const [[invoice]] = await pool.query(
      "SELECT total, status FROM sales_invoices WHERE id = ?",
      [req.params.invoiceId],
    );

    return success(res, {
      receipts: rows,
      summary: {
        invoice_total: invoice?.total || 0,
        total_paid,
        balance_due: Math.max(0, (invoice?.total || 0) - total_paid),
        invoice_status: invoice?.status || "unknown",
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /receipts/:id/send
// Mark receipt as sent to customer (email sending to be wired in)
// ─────────────────────────────────────────────────────────
const sendReceipt = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT r.*, c.email as customer_email FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ? AND r.company_id = ?",
      [req.params.id, req.user.company_id],
    );

    if (!rows.length) return error(res, "Receipt not found", 404);

    const receipt = rows[0];

    // TODO: Wire in email service here — sendReceiptEmail({ to: receipt.customer_email, receipt })
    // For now we log and mark as sent
    console.log(
      `[Receipt] Sending ${receipt.receipt_number} to ${receipt.customer_email}`,
    );

    await pool.query(
      `UPDATE receipts SET sent_to_customer = 1, sent_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [req.params.id],
    );

    return success(
      res,
      { sent_to: receipt.customer_email },
      "Receipt marked as sent",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// DELETE /receipts/:id
// Only manually created receipts can be deleted
// Auto-generated (Paystack) receipts are immutable
// ─────────────────────────────────────────────────────────
const deleteReceipt = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, is_auto_generated, sales_invoice_id FROM receipts WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id],
    );

    if (!rows.length) return error(res, "Receipt not found", 404);
    if (rows[0].is_auto_generated) {
      return error(res, "Auto-generated receipts cannot be deleted", 403);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      await conn.query("DELETE FROM receipts WHERE id = ?", [req.params.id]);

      // Re-sync invoice status now that this payment is gone
      await syncInvoicePaymentStatus(conn, rows[0].sales_invoice_id);

      await conn.commit();
      conn.release();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.DELETE,
      entity: "receipt",
      entityId: req.params.id,
      req,
    });

    return success(res, {}, "Receipt deleted");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /sales-invoices/:id/mark-paid  (override)
// Manually mark invoice as fully paid + auto-generate receipt
// ─────────────────────────────────────────────────────────
const markInvoicePaidWithReceipt = async (req, res, next) => {
  try {
    const { payment_method, payment_date, note, currency } = req.body;

    const [invoices] = await pool.query(
      `SELECT si.*, c.id as customer_id, c.name as customer_name FROM sales_invoices si
       LEFT JOIN customers c ON c.id = si.customer_id
       WHERE si.id = ? AND si.company_id = ?`,
      [req.params.id, req.user.company_id],
    );

    if (!invoices.length) return error(res, "Invoice not found", 404);

    const invoice = invoices[0];

    if (invoice.status === "paid")
      return error(res, "Invoice is already marked as paid", 400);
    if (invoice.status === "cancelled")
      return error(res, "Cannot mark a cancelled invoice as paid", 400);

    // Calculate remaining balance based on receipts already issued
    const [[{ already_paid }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0) as already_paid FROM receipts WHERE sales_invoice_id = ?`,
      [req.params.id],
    );

    const remaining = parseFloat(invoice.total) - parseFloat(already_paid);

    if (remaining <= 0) {
      // Already fully paid via receipts — just sync status
      await pool.query(
        `UPDATE sales_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [req.params.id],
      );
      return success(res, {}, "Invoice status updated to paid");
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const pDate = payment_date || new Date().toISOString().split("T")[0];
      const { company_name, bank_name, bank_account_number } =
        await getCompanySnapshot(conn, req.user.company_id);

      // Mark invoice paid
      await conn.query(
        `UPDATE sales_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [req.params.id],
      );

      // Auto-generate receipt for the remaining balance
      const receiptId = uuidv4();
      const receiptNumber = await generateReceiptNumber(req.user.company_id);

      await conn.query(
        `INSERT INTO receipts (id, receipt_number, company_id, company_name, sales_invoice_id, customer_id,
          customer_name, amount_paid, payment_method, payment_date, bank_account_number, bank_name,
          currency, note, issued_by, is_auto_generated, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          receiptId,
          receiptNumber,
          req.user.company_id,
          company_name,
          req.params.id,
          invoice.customer_id || null,
          invoice.customer_name || null,
          remaining,
          payment_method || "manual",
          pDate,
          bank_account_number,
          bank_name,
          currency || "NGN",
          note || "Marked as paid manually",
          req.user.id,
        ],
      );

      await conn.commit();
      conn.release();

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.UPDATE,
        entity: "sales_invoice",
        entityId: req.params.id,
        details: { action: "mark_paid", receipt_id: receiptId },
        req,
      });

      return success(
        res,
        {
          receipt_id: receiptId,
          receipt_number: receiptNumber,
          amount_settled: remaining,
        },
        "Invoice marked as paid. Receipt generated.",
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

module.exports = {
  createReceipt,
  getReceipts,
  getReceipt,
  getReceiptsByInvoice,
  sendReceipt,
  deleteReceipt,
  markInvoicePaidWithReceipt,
  autoGenerateReceiptFromPaystack, // used internally by subscription/paystack controller
};
