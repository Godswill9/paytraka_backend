const { pool } = require("../config/db");
const { success, error } = require("../utils/response");
const { uploadToCloudflare } = require("../config/cloudflare");
const axios = require("axios");

const REDTECH_ENVIRONMENTS = {
  test: {
    baseUrlEnv: "FIRS_BASE_URL_TEST",
    firsBusinessIdField: "nrs_businessid_test",
    redtechBusinessIdField: "redtech_businessid_test",
    stage: "dev",
  },
  live: {
    baseUrlEnv: "FIRS_BASE_URL_LIVE",
    firsBusinessIdField: "nrs_businessid_live",
    redtechBusinessIdField: "redtech_businessid_live",
    stage: "prod",
  },
};

const getRedtechBusinessId = (responseData) => {
  if (typeof responseData === "string") {
    const value = responseData.trim();
    if (!value) return null;

    try {
      return getRedtechBusinessId(JSON.parse(value));
    } catch {
      return value;
    }
  }

  const containers = [
    responseData,
    responseData?.data,
    responseData?.result,
    responseData?.data?.data,
    responseData?.data?.result,
  ];

  for (const container of containers) {
    if (!container || typeof container !== "object") continue;

    const businessId =
      container.businessId ??
      container.businessID ??
      container.business_id ??
      container.id;

    if (typeof businessId === "string" && businessId.trim()) {
      return businessId.trim();
    }
  }

  return null;
};

const requestRedtechBusinessId = async (company, environment) => {
  const config = REDTECH_ENVIRONMENTS[environment];
  const baseURL = process.env[config.baseUrlEnv]?.replace(/\/+$/, "");

  if (!baseURL) {
    throw new Error(`${config.baseUrlEnv} is not configured`);
  }

  const payload = {
    businessAddress: company.address,
    businessAddressLg: company.lga,
    businessAddressStreetName: company.address,
    businessCity: company.city,
    businessCountry: company.country,
    businessFirsId: company[config.firsBusinessIdField],
    businessPostalCode: company.postal_code,
    businessState: company.state,
    contactEmail: company.business_email,
    entityFirsId: company.nrs_entityid,
    firsApiKey: company.nrs_apikey,
    firsApiSecret: company.nrs_apisecret,
  };

  const response = await axios.post(
    `${baseURL}/external/request-business-key`,
    payload,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      params: { stage: config.stage },
      timeout: 30000,
    },
  );

  const businessId = getRedtechBusinessId(response.data);
  if (!businessId) {
    throw new Error("Redtech response did not contain a business ID");
  }

  return businessId;
};

const generateAndSaveRedtechBusinessIds = async (companyId) => {
  const [rows] = await pool.query(
    `SELECT id, business_email, address, city, state, country, lga, postal_code,
            nrs_businessid_test, nrs_businessid_live, nrs_apikey,
            nrs_apisecret, nrs_entityid, redtech_businessid_test,
            redtech_businessid_live
     FROM companies
     WHERE id = ?`,
    [companyId],
  );

  if (!rows.length) return;

  const company = rows[0];
  const commonRequiredValues = [
    company.business_email,
    company.address,
    company.city,
    company.state,
    company.country,
    company.lga,
    company.postal_code,
    company.nrs_apikey,
    company.nrs_apisecret,
    company.nrs_entityid,
  ];

  if (
    commonRequiredValues.some(
      (value) => value === undefined || value === null || value === "",
    )
  ) {
    return;
  }

  const environmentsToRegister = Object.keys(REDTECH_ENVIRONMENTS).filter(
    (environment) => {
      const config = REDTECH_ENVIRONMENTS[environment];
      return (
        company[config.firsBusinessIdField] &&
        !company[config.redtechBusinessIdField]
      );
    },
  );

  if (!environmentsToRegister.length) return;

  const registrationResults = await Promise.allSettled(
    environmentsToRegister.map(async (environment) => ({
      environment,
      businessId: await requestRedtechBusinessId(company, environment),
    })),
  );

  const generatedIds = {};
  registrationResults.forEach((result) => {
    if (result.status !== "fulfilled") {
      console.error(
        "Redtech business ID generation failed:",
        result.reason?.response?.data ||
          result.reason?.message ||
          result.reason,
      );
      return;
    }

    const config = REDTECH_ENVIRONMENTS[result.value.environment];
    generatedIds[config.redtechBusinessIdField] = result.value.businessId;
  });

  if (!Object.keys(generatedIds).length) return;

  const sets = Object.keys(generatedIds)
    .map((column) => `${column} = ?`)
    .join(", ");

  await pool.query(
    `UPDATE companies SET ${sets}, updated_at = NOW() WHERE id = ?`,
    [...Object.values(generatedIds), companyId],
  );
};

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
      "business_description",
      "industry",
      "nrs_businessid_test",
      "nrs_businessid_live",
      "nrs_apikey",
      "nrs_apisecret",
      "nrs_entityid",
      "nrs_publickey",
      "nrs_certificate",
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

    await generateAndSaveRedtechBusinessIds(req.user.company_id);

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
const toNull = (val) =>
  val === "" || val === undefined || val === null ? null : val;

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

      nrs_businessid_test,
      nrs_businessid_live,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
      business_description,
      company_size,
      annual_turnover,
      industry,
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

    const firsEnabled = !!(
      nrs_businessid_test ||
      nrs_businessid_live ||
      nrs_apikey ||
      nrs_apisecret ||
      nrs_entityid ||
      nrs_publickey ||
      nrs_certificate
    );

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
      trading_name: toNull(trading_name),
      business_email,
      business_phone,
      tax_identification_number: toNull(tax_identification_number),
      vat_number: toNull(vat_number),
      rc_number,
      business_type,
      address,
      city,
      state,
      country,
      lga: toNull(lga),
      postal_code: toNull(postal_code),
      website: toNull(website),
      bank_name: toNull(bank_name),
      account_number: toNull(account_number),
      account_name: toNull(account_name),
      payment_method: toNull(payment_method),

      nrs_businessid_test: toNull(nrs_businessid_test),
      nrs_businessid_live: toNull(nrs_businessid_live),
      nrs_apikey: toNull(nrs_apikey),
      nrs_apisecret: toNull(nrs_apisecret),
      nrs_entityid: toNull(nrs_entityid),
      nrs_publickey: toNull(nrs_publickey),
      nrs_certificate: toNull(nrs_certificate),

      firs_enabled: firsEnabled ? 1 : 0,

      status: "active",
      business_description: toNull(business_description),
      company_size: toNull(company_size),
      annual_turnover: toNull(annual_turnover),
      industry: toNull(industry),
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

    await generateAndSaveRedtechBusinessIds(req.user.company_id);

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
      "mode",
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
      nrs_businessid_test,
      nrs_businessid_live,
      nrs_apikey,
      nrs_apisecret,
      nrs_entityid,
      nrs_publickey,
      nrs_certificate,
    } = req.body;

    const fields = {
      nrs_businessid_test,
      nrs_businessid_live,
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
