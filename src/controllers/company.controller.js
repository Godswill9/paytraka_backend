const { pool } = require("../config/db");
const { success, error } = require("../utils/response");
const { uploadToCloudflare } = require("../config/cloudflare");

// ─────────────────────────────────────────────────────────
// GET /companies/:id
// ─────────────────────────────────────────────────────────
const getCompany = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM companies WHERE id = ? AND owner_user_id = ?",
      [req.user.company_id, req.user.id],
    );
    if (!rows.length) return error(res, "Company not found", 404);

    // Hide sensitive NRS credentials from response
    const company = { ...rows[0] };
    delete company.nrs_apikey;
    delete company.nrs_apisecret;
    delete company.nrs_certificate;

    return success(res, company);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id
// General company update (name, contact, address etc.)
// ─────────────────────────────────────────────────────────
const updateCompany = async (req, res, next) => {
  try {
    // Upload logo if attached
    let logo_url;
    if (req.file) {
      const uploaded = await uploadToCloudflare(
        req.file.buffer,
        req.file.originalname,
        "logos",
      );
      logo_url = uploaded.url;
    }

    const allowed = [
      "company_name",
      "trading_name",
      "business_email",
      "business_phone",
      "bank_name",
      "account_number",
      "account_name",
      "payment_method",
      "address",
      "city",
      "state",
      "country",
      "lga",
      "postal_code",
      "website",
      "accent_colour",
      "invoice_template",
    ];

    const fields = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    });
    if (logo_url) fields.logo_url = logo_url;

    if (!Object.keys(fields).length)
      return error(res, "No valid fields to update", 400);

    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(fields), req.user.company_id];

    await pool.query(
      `UPDATE companies SET ${sets}, updated_at = NOW() WHERE id = ?`,
      values,
    );

    return success(res, {}, "Company updated");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id/kyc
// KYC — full business verification info
// Called after OTP verification when user fills in company details
// ─────────────────────────────────────────────────────────
const submitKyc = async (req, res, next) => {
  try {
    const {
      company_name,
      trading_name,
      business_email,
      business_phone,
      tax_identification_number,
      vat_number,
      rc_number,
      business_type,
      address,
      city,
      state,
      country,
      lga,
      postal_code,
      website,
      bank_name,
      account_number,
      account_name,
      payment_method,

      nrs_businessid,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
    } = req.body;

    if (
      !company_name ||
      !rc_number ||
      !business_type ||
      !address ||
      !city ||
      !state ||
      !country
    ) {
      return error(
        res,
        "company_name, rc_number, business_type, address, city, state and country are required for KYC",
        400,
      );
    }

    // Upload logo if provided
    let logo_url;
    if (req.file) {
      const uploaded = await uploadToCloudflare(
        req.file.buffer,
        req.file.originalname,
        "logos",
      );
      logo_url = uploaded.url;
    }

    const fields = {
      company_name,
      trading_name,
      business_email,
      business_phone,
      tax_identification_number,
      vat_number,
      rc_number,
      business_type,
      address,
      city,
      state,
      country,
      lga,
      postal_code,
      website,
      bank_name,
      account_number,
      account_name,
      payment_method,
      nrs_businessid,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
      status: "active", // activate company on KYC completion
    };

    if (logo_url) fields.logo_url = logo_url;

    // Remove undefined
    Object.keys(fields).forEach(
      (k) => fields[k] === undefined && delete fields[k],
    );

    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(fields), req.user.company_id];

    await pool.query(
      `UPDATE companies SET ${sets}, updated_at = NOW() WHERE id = ?`,
      values,
    );

    return success(
      res,
      {},
      "KYC submitted. Your company profile is now active.",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id/firs-settings
// Toggle FIRS and invoice behaviour flags
// ─────────────────────────────────────────────────────────
const updateFirsSettings = async (req, res, next) => {
  try {
    const allowed = [
      "firs_enabled",
      "generate_payment_link",
      "display_bank_details_on_invoice",
      "auto_submit_to_firs",
    ];

    const fields = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) fields[k] = req.body[k] ? 1 : 0;
    });

    if (!Object.keys(fields).length)
      return error(res, "No valid FIRS settings to update", 400);

    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(fields), req.user.company_id];

    await pool.query(
      `UPDATE companies SET ${sets}, updated_at = NOW() WHERE id = ?`,
      values,
    );

    return success(res, {}, "FIRS settings updated");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id/nrs-credentials
// Save NRS (FIRS portal) API credentials
// ─────────────────────────────────────────────────────────
const updateNrsCredentials = async (req, res, next) => {
  try {
    const {
      nrs_businessid,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
    } = req.body;

    const fields = {
      nrs_businessid,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
    };
    Object.keys(fields).forEach(
      (k) => fields[k] === undefined && delete fields[k],
    );

    if (!Object.keys(fields).length)
      return error(res, "No NRS credential fields provided", 400);

    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(fields), req.user.company_id];

    await pool.query(
      `UPDATE companies SET ${sets}, updated_at = NOW() WHERE id = ?`,
      values,
    );

    return success(res, {}, "NRS credentials saved");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /companies/:id/mode
// ─────────────────────────────────────────────────────────
const getMode = async (req, res, next) => {
  try {
    // mode lives in company_settings, fall back gracefully
    const [rows] = await pool.query(
      "SELECT mode FROM company_settings WHERE company_id = ?",
      [req.user.company_id],
    );
    return success(res, { mode: rows[0]?.mode || "demo" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id/mode
// ─────────────────────────────────────────────────────────
const switchMode = async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!["demo", "live"].includes(mode))
      return error(res, "mode must be demo or live", 400);

    await pool.query(
      `UPDATE company_settings SET mode = ?, updated_at = NOW() WHERE company_id = ?`,
      [mode, req.user.company_id],
    );

    return success(res, { mode }, `Switched to ${mode} mode`);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /companies/:id/settings
// ─────────────────────────────────────────────────────────
const getSettings = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM company_settings WHERE company_id = ?",
      [req.user.company_id],
    );
    return success(res, rows[0] || {});
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /companies/:id/settings
// ─────────────────────────────────────────────────────────
const updateSettings = async (req, res, next) => {
  try {
    const allowed = [
      "currency",
      "date_format",
      "invoice_prefix",
      "default_tax_rate",
      "default_payment_terms",
      "invoice_footer_note",
    ];

    const sets = allowed
      .filter((k) => req.body[k] !== undefined)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = allowed
      .filter((k) => req.body[k] !== undefined)
      .map((k) => req.body[k]);

    if (!sets) return error(res, "No valid settings fields to update", 400);
    values.push(req.user.company_id);

    await pool.query(
      `UPDATE company_settings SET ${sets}, updated_at = NOW() WHERE company_id = ?`,
      values,
    );

    return success(res, {}, "Settings updated");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCompany,
  updateCompany,
  submitKyc,
  updateFirsSettings,
  updateNrsCredentials,
  getMode,
  switchMode,
  getSettings,
  updateSettings,
};
