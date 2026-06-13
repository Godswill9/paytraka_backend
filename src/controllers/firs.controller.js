const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, error } = require("../utils/response");
const { getFirsConfig, firsRequest } = require("../config/firs");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");

// Get company mode (demo/live)
const getCompanyMode = async (companyId) => {
  const [[company]] = await pool.query(
    "SELECT mode FROM companies WHERE id = ?",
    [companyId],
  );
  return company?.mode || "demo";
};

// Format JS Date / date string -> 'YYYY-MM-DD'
const toDateStr = (d) => {
  if (!d) return null;
  const date = new Date(d);
  return date.toISOString().split("T")[0];
};

// Format time -> 'HH:mm:ss'
const toTimeStr = (d) => {
  const date = d ? new Date(d) : new Date();
  return date.toTimeString().split(" ")[0];
};

// Map our invoice + company + lineitems into RedTech's MINIMAL invoice payload
// const mapInvoiceToFirs = (invoice, company, lineitems, businessId) => {
//   const taxRate = lineitems[0]?.tax_rate ? Number(lineitems[0].tax_rate) : 7.5;

//   return {
//     requestType: "MINIMAL",
//     // invoiceNumber: invoice.invoice_number,
//     invoiceNumber: invoice.invoice_number?.replace(/-/g, "") || "",
//     invoiceBusinessId: businessId,
//     invoiceEntityId: company.firs_entity_id || businessId,
//     invoiceIssueDate: toDateStr(invoice.issue_date),
//     invoiceDueDate: toDateStr(invoice.due_date),
//     invoiceIssueTime: toTimeStr(invoice.created_at),
//     invoiceTypeCode: "389",
//     invoicePaymentStatus: invoice.status === "paid" ? "PAID" : "UNPAID",
//     invoiceNote: invoice.note || "",
//     invoiceTaxPointDate: toDateStr(invoice.issue_date),
//     invoiceDocumentCurrencyCode: invoice.currency || "NGN",
//     invoiceTaxCurrencyCode: invoice.currency || "NGN",

//     // Buyer
//     invoiceCustomerPartyId: invoice.customer_id || "",
//     invoiceCustomerPartyTin: invoice.customer_tax_id || "",
//     invoiceCustomerPartyEmail: invoice.customer_email || "",
//     invoiceCustomerPartyTelephone: invoice.customer_phone || "",
//     invoiceCustomerPartyBusinessDescription:
//       invoice.customer_business_description || "",
//     invoiceCustomerPartyName: invoice.customer_name || "",
//     invoiceCustomerCityName: invoice.customer_city || "",
//     invoiceCustomerPostalZone: invoice.customer_postal_zone || "",
//     invoiceCustomerCountry: invoice.customer_country || "NG",
//     invoiceCustomerStreetName: invoice.customer_address || "",
//     invoiceCustomerLga: invoice.customer_lga || "",
//     invoiceCustomerState: invoice.customer_state || "",

//     // Supplier (our company)
//     invoiceSupplierPartyId: businessId,
//     invoiceSupplierPartyTin:
//       company.tax_identification_number || company.tax_id || "",
//     invoiceSupplierPartyEmail: company.business_email || "",
//     invoiceSupplierPartyTelephone: company.business_phone || "",
//     invoiceSupplierPartyBusinessDescription: company.business_description || "",
//     invoiceSupplierPartyName: company.company_name || company.name || "",
//     invoiceSupplierLga: company.lga || "",
//     invoiceSupplierState: company.state || "",
//     invoiceSupplierCityName: company.city || "",
//     invoiceSupplierPostalZone: company.postal_code || "",
//     invoiceSupplierCountry: company.country || "NG",
//     invoiceSupplierStreetName: company.address || "",

//     // Totals
//     invoiceLineExtensionAmount: Number(invoice.subtotal),
//     invoiceTaxExclusiveAmount: Number(invoice.subtotal),
//     invoiceTaxInclusiveAmount: Number(invoice.total),
//     invoicePayableAmount: Number(invoice.total),

//     invoiceAllowanceCharge: [
//       {
//         invoiceAllowanceChargeIndicator: false,
//         invoiceAllowanceChargeAmount: Number(invoice.tax_amount || 0),
//       },
//     ],

//     invoiceLine: lineitems.map((item, i) => {
//       const qty = Number(item.quantity || 0);
//       const price = Number(item.unit_price || 0);
//       const discount = Number(item.discount_amount || 0);
//       const tax = Number(item.tax_amount || 0);

//       const lineTotal = Number(item.line_total || qty * price - discount);

//       return {
//         invoiceLineProductCategory:
//           item.product_category || "General Goods/Services",

//         invoiceLineInvoicedQuantity: qty,

//         invoiceLineExtensionAmount: lineTotal,

//         invoiceLineItemName: item.item_name || "Item",

//         invoiceLineItemDescription: item.description || "",

//         invoiceLinePriceAmount: price,

//         invoiceLinePriceBaseQuantity: 1,

//         invoiceLinePriceUnit: "UNIT",

//         // REQUIRED BY REDTECH (from sample)
//         invoiceLineDiscountRate:
//           discount && price ? discount / (qty * price) : 0,

//         invoiceLineDiscountAmount: discount || 0,

//         invoiceLineFeeRate: 0,

//         invoiceLineFeeAmount: tax || 0,

//         invoiceLineHsnCode: "0000",
//       };
//     }),
//     invoiceTaxTotal: [
//       {
//         invoiceTaxTotalAmount: Number(invoice.tax_amount || 0),

//         invoiceTaxTotalSubTotal: [
//           {
//             taxSubTotalTaxableAmount: Number(invoice.subtotal || 0),

//             taxSubTotalTaxAmount: Number(invoice.tax_amount || 0),

//             taxSubTotalCategoryId: "STANDARD_VAT",

//             taxSubTotalCategoryPercent: taxRate,
//           },
//         ],
//       },
//     ],
//   };
// };

const mapInvoiceToFirs = (invoice, company, lineitems, businessId) => {
  const taxRate = lineitems[0]?.tax_rate ? Number(lineitems[0].tax_rate) : 7.5;

  // Calculate from actual line items — don't trust invoice-level fields
  const lineItemsExtensionAmount = lineitems.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const price = Number(item.unit_price || 0);
    const discount = Number(item.discount_amount || 0);
    return sum + (qty * price - discount);
  }, 0);

  const totalTax = lineitems.reduce(
    (sum, item) => sum + Number(item.tax_amount || 0),
    0,
  );
  const totalWithTax = lineItemsExtensionAmount + totalTax;

  return {
    requestType: "MINIMAL",
    invoiceNumber: invoice.invoice_number?.replace(/-/g, "") || "",
    invoiceBusinessId: businessId,
    invoiceEntityId: company.firs_entity_id || businessId,
    invoiceIssueDate: toDateStr(invoice.issue_date),
    invoiceDueDate: toDateStr(invoice.due_date),
    invoiceIssueTime: toTimeStr(invoice.created_at),
    invoiceTypeCode: "389",
    invoicePaymentStatus: invoice.status === "paid" ? "PAID" : "UNPAID",
    invoiceNote: invoice.note || "",
    invoiceTaxPointDate: toDateStr(invoice.issue_date),
    invoiceDocumentCurrencyCode: invoice.currency || "NGN",
    invoiceTaxCurrencyCode: invoice.currency || "NGN",

    // Buyer
    invoiceCustomerPartyId: invoice.customer_id || "",
    invoiceCustomerPartyTin: invoice.customer_tax_id || "",
    invoiceCustomerPartyEmail: invoice.customer_email || "",
    invoiceCustomerPartyTelephone: invoice.customer_phone || "",
    invoiceCustomerPartyBusinessDescription:
      invoice.customer_business_description || "",
    invoiceCustomerPartyName: invoice.customer_name || "",
    invoiceCustomerCityName: invoice.customer_city || "",
    invoiceCustomerPostalZone: invoice.customer_postal_zone || "",
    invoiceCustomerCountry: invoice.customer_country || "NG",
    invoiceCustomerStreetName: invoice.customer_address || "",
    invoiceCustomerLga: invoice.customer_lga || "",
    invoiceCustomerState: invoice.customer_state || "",

    // Supplier
    invoiceSupplierPartyId: businessId,
    invoiceSupplierPartyTin:
      company.tax_identification_number || company.tax_id || "",
    invoiceSupplierPartyEmail: company.business_email || "",
    invoiceSupplierPartyTelephone: company.business_phone || "",
    invoiceSupplierPartyBusinessDescription: company.business_description || "",
    invoiceSupplierPartyName: company.company_name || company.name || "",
    invoiceSupplierLga: company.lga || "",
    invoiceSupplierState: company.state || "",
    invoiceSupplierCityName: company.city || "",
    invoiceSupplierPostalZone: company.postal_code || "",
    invoiceSupplierCountry: company.country || "NG",
    invoiceSupplierStreetName: company.address || "",

    // ✅ Totals derived from actual line items
    invoiceLineExtensionAmount: lineItemsExtensionAmount,
    invoiceTaxExclusiveAmount: lineItemsExtensionAmount,
    invoiceTaxInclusiveAmount: totalWithTax,
    invoicePayableAmount: totalWithTax,

    // Omit the key entirely when no discount
    ...(invoice.discount_amount
      ? {
          invoiceAllowanceCharge: [
            {
              invoiceAllowanceChargeIndicator: false,
              invoiceAllowanceChargeAmount: 500,
            },
          ],
        }
      : {}),

    invoiceLine: lineitems.map((item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || 0);
      const discount = Number(item.discount_amount || 0);
      const tax = Number(item.tax_amount || 0);
      const lineExt = qty * price - discount; // ✅ matches what we summed above

      return {
        invoiceLineProductCategory:
          item.product_category || "General Goods/Services",
        invoiceLineInvoicedQuantity: qty,
        invoiceLineExtensionAmount: lineExt, // ✅ tax-exclusive line total
        invoiceLineItemName: item.item_name || "Item",
        invoiceLineItemDescription: item.description || "",
        invoiceLinePriceAmount: price,
        invoiceLinePriceBaseQuantity: 1,
        invoiceLinePriceUnit: "UNIT",
        invoiceLineDiscountRate:
          discount && price ? discount / (qty * price) : 0,
        invoiceLineDiscountAmount: discount || 0,
        invoiceLineFeeRate: 0,
        invoiceLineFeeAmount: tax || 0,
        invoiceLineHsnCode: "0000",
      };
    }),

    invoiceTaxTotal: [
      {
        invoiceTaxTotalAmount: totalTax,
        invoiceTaxTotalSubTotal: [
          {
            taxSubTotalTaxableAmount: lineItemsExtensionAmount,
            taxSubTotalTaxAmount: totalTax,
            taxSubTotalCategoryId: "STANDARD_VAT",
            taxSubTotalCategoryPercent: taxRate,
          },
        ],
      },
    ],
  };
};

// Fetch invoice + customer + company + lineitems needed for FIRS submission
const loadInvoiceForFirs = async (invoiceId, companyId) => {
  const [invoices] = await pool.query(
    `SELECT si.*,
            c.id as customer_id, c.name as customer_name, c.tax_identification_number as customer_tax_id,
            c.billing_address as customer_address, c.email as customer_email, c.phone1 as customer_phone,
            c.city as customer_city, c.state as customer_state, c.lga as customer_lga,
            c.country as customer_country, c.postal_code as customer_postal_zone,
            c.business_description as customer_business_description
     FROM sales_invoices si
     LEFT JOIN customers c ON c.id = si.customer_id
     WHERE si.id = ? AND si.company_id = ?`,
    [invoiceId, companyId],
  );
  if (!invoices.length) return null;

  const [[company]] = await pool.query("SELECT * FROM companies WHERE id = ?", [
    companyId,
  ]);
  const [lineitems] = await pool.query(
    "SELECT * FROM sales_invoice_lineitems WHERE invoice_id = ?",
    [invoiceId],
  );

  return { invoice: invoices[0], company, lineitems };
};

// ─────────────────────────────────────────────────────────
// POST /firs/submit
// Submit an invoice to FIRS via RedTech
// ─────────────────────────────────────────────────────────
const submitToFirs = async (req, res, next) => {
  try {
    const { invoice_id } = req.body;
    if (!invoice_id) return error(res, "invoice_id is required", 400);

    const mode = await getCompanyMode(req.user.company_id);
    const data = await loadInvoiceForFirs(invoice_id, req.user.company_id);
    if (!data) return error(res, "Invoice not found", 404);
    const { invoice, company, lineitems } = data;

    if (!lineitems.length) return error(res, "Invoice has no line items", 400);

    // Check if already submitted
    const [existing] = await pool.query(
      `SELECT id, status FROM firs_submissions WHERE invoice_id = ? AND status IN ('submitted', 'accepted')`,
      [invoice_id],
    );
    if (existing.length)
      return error(res, "Invoice already submitted to FIRS", 409);

    const { businessId } = getFirsConfig(mode);
    const payload = mapInvoiceToFirs(invoice, company, lineitems, businessId);
    console.log(payload);
    const submissionId = uuidv4();
    const publicId = uuidv4();
    await pool.query(
      `INSERT INTO firs_submissions (id, public_id, company_id, invoice_id, mode, request_payload, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        submissionId,
        publicId,
        req.user.company_id,
        invoice_id,
        mode,
        JSON.stringify(payload),
      ],
    );

    try {
      const client = firsRequest(mode);
      const response = await client.post(
        `/external/businesses/${businessId}/invoices`,
        payload,
      );

      await pool.query(
        `UPDATE firs_submissions SET status = 'submitted', irn = ?, response_payload = ?, submitted_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [invoice.invoice_number, JSON.stringify(response.data), submissionId],
      );

      await audit({
        userId: req.user.id,
        companyId: req.user.company_id,
        action: AUDIT_ACTIONS.SUBMIT_FIRS,
        entity: "sales_invoice",
        entityId: invoice_id,
        req,
      });

      return success(
        res,
        {
          submission_id: submissionId,
          invoice_number: invoice.invoice_number,
          response: response.data,
        },
        "Invoice submitted to FIRS successfully",
      );
    } catch (firsErr) {
      const responseData = firsErr.response?.data || { error: firsErr.message };
      await pool.query(
        `UPDATE firs_submissions SET status = 'failed', response_payload = ?, updated_at = NOW() WHERE id = ?`,
        [JSON.stringify(responseData), submissionId],
      );
      return error(
        res,
        `FIRS submission failed: ${JSON.stringify(responseData)}`,
        502,
      );
    }
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /firs/payment-status
// Update an invoice's payment status on FIRS (PAID / UNPAID)
// ─────────────────────────────────────────────────────────
const updateInvoicePaymentStatus = async (req, res, next) => {
  try {
    const { invoice_id, invoice_status } = req.body;
    if (!invoice_id || !invoice_status) {
      return error(res, "invoice_id and invoice_status are required", 400);
    }

    const status = String(invoice_status).toUpperCase();
    if (!["PAID", "UNPAID"].includes(status)) {
      return error(res, "invoice_status must be PAID or UNPAID", 400);
    }

    const mode = await getCompanyMode(req.user.company_id);

    const [[invoice]] = await pool.query(
      "SELECT id, invoice_number FROM sales_invoices WHERE id = ? AND company_id = ?",
      [invoice_id, req.user.company_id],
    );
    if (!invoice) return error(res, "Invoice not found", 404);

    // Must have been submitted to FIRS first
    const [submissions] = await pool.query(
      `SELECT id FROM firs_submissions WHERE invoice_id = ? AND status IN ('submitted', 'accepted') ORDER BY created_at DESC LIMIT 1`,
      [invoice_id],
    );
    if (!submissions.length)
      return error(res, "Invoice has not been submitted to FIRS yet", 400);

    const { businessId } = getFirsConfig(mode);
    const client = firsRequest(mode);

    const response = await client.post(
      `/external/businesses/${businessId}/invoices/update-payment/${invoice.invoice_number}`,
      null,
      { params: { invoiceStatus: status } },
    );

    await pool.query(
      `UPDATE firs_submissions SET response_payload = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(response.data), submissions[0].id],
    );

    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.UPDATE,
      entity: "firs_submission",
      entityId: submissions[0].id,
      details: { action: "update_payment_status", invoice_status: status },
      req,
    });

    return success(
      res,
      {
        invoice_number: invoice.invoice_number,
        invoice_status: status,
        response: response.data,
      },
      "FIRS payment status updated",
    );
  } catch (err) {
    if (err.response) {
      return error(
        res,
        `FIRS update failed: ${JSON.stringify(err.response.data)}`,
        502,
      );
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /firs/invoices/:invoiceId/qr
// Get the FIRS QR code for a submitted invoice
// ─────────────────────────────────────────────────────────
const getInvoiceQrCode = async (req, res, next) => {
  try {
    const mode = await getCompanyMode(req.user.company_id);

    const [[invoice]] = await pool.query(
      "SELECT id, invoice_number FROM sales_invoices WHERE id = ? AND company_id = ?",
      [req.params.invoiceId, req.user.company_id],
    );
    if (!invoice) return error(res, "Invoice not found", 404);

    const [submissions] = await pool.query(
      `SELECT id FROM firs_submissions WHERE invoice_id = ? AND status IN ('submitted', 'accepted') ORDER BY created_at DESC LIMIT 1`,
      [req.params.invoiceId],
    );
    if (!submissions.length)
      return error(res, "Invoice has not been submitted to FIRS yet", 400);

    const { businessId } = getFirsConfig(mode);
    const client = firsRequest(mode);

    const response = await client.get(
      `/external/businesses/${businessId}/invoices/${invoice.invoice_number}/qr`,
    );

    return success(res, response.data);
  } catch (err) {
    if (err.response) {
      return error(
        res,
        `FIRS QR fetch failed: ${JSON.stringify(err.response.data)}`,
        502,
      );
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /firs/health
// FIRS business health check
// ─────────────────────────────────────────────────────────
const getBusinessHealthCheck = async (req, res, next) => {
  try {
    const mode = await getCompanyMode(req.user.company_id);
    const { businessId } = getFirsConfig(mode);
    const client = firsRequest(mode);

    const response = await client.get(
      `/external/businesses/${businessId}/health`,
    );
    return success(res, response.data);
  } catch (err) {
    if (err.response) {
      return error(
        res,
        `FIRS health check failed: ${JSON.stringify(err.response.data)}`,
        502,
      );
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /firs/submissions
// ─────────────────────────────────────────────────────────
const getSubmissions = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT fs.*, si.invoice_number FROM firs_submissions fs
       LEFT JOIN sales_invoices si ON si.id = fs.invoice_id
       WHERE fs.company_id = ? ORDER BY fs.created_at DESC`,
      [req.user.company_id],
    );
    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /firs/submissions/:id
// ─────────────────────────────────────────────────────────
const getSubmission = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT fs.*, si.invoice_number FROM firs_submissions fs
       LEFT JOIN sales_invoices si ON si.id = fs.invoice_id
       WHERE fs.id = ? AND fs.company_id = ?`,
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) return error(res, "Submission not found", 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitToFirs,
  updateInvoicePaymentStatus,
  getInvoiceQrCode,
  getBusinessHealthCheck,
  getSubmissions,
  getSubmission,
};
