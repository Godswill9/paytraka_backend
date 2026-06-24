require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { success, created, error } = require("../utils/response");
const { audit } = require("../middlewares/audit.middleware");
const { AUDIT_ACTIONS } = require("../config/constants");
const {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} = require("../utils/email");

// ── Helpers ───────────────────────────────────────────────

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const generateTokens = (userId, companyId) => {
  const payload = { userId, companyId };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  });
  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────
// POST /auth/register
// Collects user + company info → saves as unverified → sends OTP
// ─────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      password,
      company_name, // required
      trading_name, // optional
    } = req.body;

    if (
      !first_name ||
      !last_name ||
      !email ||
      !phone ||
      !password ||
      !company_name
    ) {
      return error(
        res,
        "first_name, last_name, email, phone, password and company_name are required",
        400,
      );
    }

    if (password.length < 7) {
      return error(res, "Password must be at least 7 characters", 400);
    }

    // Check duplicate email
    const [existing] = await pool.query(
      "SELECT id, status FROM users WHERE email = ?",
      [email],
    );

    if (existing.length) {
      const u = existing[0];
      if (u.status === "not-verified") {
        // Resend OTP instead of blocking
        const otp = generateOtp();
        const now = new Date();

        await pool.query(
          `UPDATE registration_codes SET is_used = 1 WHERE user_id = ? AND purpose = 'registration' AND is_used = 0`,
          [u.id],
        );
        await pool.query(
          `INSERT INTO registration_codes (id, code, purpose, is_used, user_id, expires_at, created_at)
           VALUES (?, ?, 'registration', 0, ?, ?, ?)`,
          [
            uuidv4(),
            otp,
            u.id,
            new Date(now.getTime() + 24 * 3600 * 1000),
            now,
          ],
        );

        const [[userRow]] = await pool.query(
          "SELECT first_name, last_name FROM users WHERE id = ?",
          [u.id],
        );

        sendOtpEmail({
          to: email,
          name: `${userRow.first_name} ${userRow.last_name}`,
          otp,
        }).catch((e) => console.error("OTP resend failed:", e.message));
        return success(
          res,
          { userId: u.id },
          "Account exists but is not verified. A new OTP has been sent to your email.",
        );
      }

      return error(res, "Email is already registered", 409);
    }

    // Check duplicate phone
    const [existingPhone] = await pool.query(
      "SELECT id FROM users WHERE phone = ?",
      [phone],
    );
    if (existingPhone.length)
      return error(res, "Phone number already registered", 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const public_id = uuidv4();
    const otp = generateOtp();
    const now = new Date();

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      await conn.query(
        `INSERT INTO users
           (id, public_id, first_name, last_name, email, phone, password_hash,
            company_name, trading_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'not-verified', ?, ?)`,
        [
          userId,
          public_id,
          first_name,
          last_name,
          email,
          phone,
          passwordHash,
          company_name,
          trading_name || null,
          now,
          now,
        ],
      );

      await conn.query(
        `INSERT INTO registration_codes (id, code, purpose, is_used, user_id, expires_at, created_at)
         VALUES (?, ?, 'registration', 0, ?, ?, ?)`,
        [
          uuidv4(),
          otp,
          userId,
          new Date(now.getTime() + 24 * 3600 * 1000),
          now,
        ],
      );

      await conn.commit();
      conn.release();
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
    sendOtpEmail({
      to: email,
      name: `${first_name} ${last_name}`,
      otp,
    }).catch((e) => console.error("Registration OTP email failed:", e.message));
    return created(
      res,
      { userId },
      "Registration started. Check your email for the OTP to verify your account.",
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      let field = "value";
      if (err.message.includes("email")) field = "email";
      else if (err.message.includes("phone")) field = "phone number";
      return error(res, `This ${field} is already registered`, 409);
    }
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/verify-otp
// Verify OTP → activate user → create company → return tokens
// ─────────────────────────────────────────────────────────
const verifyOtp = async (req, res, next) => {
  try {
    const { otp, user_id } = req.body;
    if (!otp || !user_id)
      return error(res, "otp and user_id are required", 400);

    const [codes] = await pool.query(
      `SELECT * FROM registration_codes
       WHERE code = ? AND user_id = ? AND purpose = 'registration'
         AND is_used = 0 AND expires_at > NOW()`,
      [otp, user_id],
    );
    if (!codes.length) return error(res, "Invalid or expired OTP", 400);

    const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [
      user_id,
    ]);
    if (!user) return error(res, "User not found", 404);
    if (user.status !== "not-verified")
      return error(res, "Account is already verified", 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      // Mark OTP used
      await conn.query(
        "UPDATE registration_codes SET is_used = 1, used_by = ? WHERE id = ?",
        [user_id, codes[0].id],
      );

      // Create company — use company_name & trading_name already on the user row
      const companyId = uuidv4();
      const publicId = `PT-${Date.now().toString(36).toUpperCase()}`;

      await conn.query(
        `INSERT INTO companies
           (id, public_id, owner_user_id, company_name, trading_name, business_email,
            status, firs_enabled, generate_payment_link,
            display_bank_details_on_invoice, auto_submit_to_firs, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', 0, 0, 0, 0, NOW(), NOW())`,
        [
          companyId,
          publicId,
          user_id,
          user.company_name,
          user.trading_name || null,
          user.email,
        ],
      );

      // Activate user, link company, set verified timestamp
      await conn.query(
        `UPDATE users
         SET status = 'active', role = 'admin', company_id = ?,
             email_verified_at = NOW(), last_login_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [companyId, user_id],
      );

      await conn.commit();
      conn.release();

      sendWelcomeEmail({
        to: user.email,
        name: `${user.first_name} ${user.last_name}`,
      }).catch((e) => console.error("Welcome email failed:", e.message));

      await audit({
        userId: user_id,
        companyId,
        action: AUDIT_ACTIONS.CREATE,
        entity: "user",
        entityId: user_id,
        req,
      });

      const { accessToken, refreshToken } = generateTokens(user_id, companyId);

      return success(
        res,
        {
          accessToken,
          refreshToken,
          user: {
            id: user_id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            company_id: companyId,
            company_name: user.company_name,
            role: "admin",
            status: "active",
            kyc_complete: false,
          },
        },
        "Account verified successfully. Welcome to PayTraka!",
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
// POST /auth/resend-otp
// ─────────────────────────────────────────────────────────
const resendOtp = async (req, res, next) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return error(res, "user_id is required", 400);

    const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [
      user_id,
    ]);
    if (!user) return error(res, "User not found", 404);
    if (user.status !== "not-verified")
      return error(res, "Account is already verified", 400);

    await pool.query(
      `UPDATE registration_codes SET is_used = 1 WHERE user_id = ? AND purpose = 'registration' AND is_used = 0`,
      [user_id],
    );

    const otp = generateOtp();
    const now = new Date();
    await pool.query(
      `INSERT INTO registration_codes (id, code, purpose, is_used, user_id, expires_at, created_at)
       VALUES (?, ?, 'registration', 0, ?, ?, ?)`,
      [uuidv4(), otp, user_id, new Date(now.getTime() + 24 * 3600 * 1000), now],
    );

    sendOtpEmail({
      to: user.email,
      name: `${user.first_name} ${user.last_name}`,
      otp,
    }).catch((e) => console.error("Resend OTP email failed:", e.message));

    return success(res, {}, "OTP resent to your email");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return error(res, "Email and password are required", 400);

    const [rows] = await pool.query(
      `SELECT u.id, u.public_id, u.company_id, u.first_name, u.last_name,
              u.email, u.phone, u.password_hash, u.status, u.role,
              u.company_name, u.trading_name,
              c.company_name as reg_company_name, c.status as company_status,
              c.firs_enabled, c.logo_url
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.email = ?`,
      [email],
    );

    if (!rows.length) return error(res, "Invalid email or password", 401);

    const user = rows[0];

    if (user.status === "not-verified") {
      return error(
        res,
        "Email not verified. Please check your inbox for the OTP.",
        403,
      );
    }
    if (user.status === "suspended") {
      return error(res, "Account suspended. Please contact support.", 403);
    }
    if (user.status === "inactive") {
      return error(res, "Account is inactive. Contact support.", 403);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return error(res, "Invalid email or password", 401);

    // Update last login
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [
      user.id,
    ]);

    const { accessToken, refreshToken } = generateTokens(
      user.id,
      user.company_id,
    );

    await audit({
      userId: user.id,
      companyId: user.company_id,
      action: AUDIT_ACTIONS.LOGIN,
      entity: "user",
      entityId: user.id,
      req,
    });

    return success(
      res,
      {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          public_id: user.public_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          company_id: user.company_id,
          company_name: user.reg_company_name || user.company_name,
          company_status: user.company_status,
          firs_enabled: user.firs_enabled,
          logo_url: user.logo_url,
        },
      },
      "Login successful",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    await audit({
      userId: req.user.id,
      companyId: req.user.company_id,
      action: AUDIT_ACTIONS.LOGOUT,
      entity: "user",
      entityId: req.user.id,
      req,
    });
    return success(res, {}, "Logged out successfully");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/refresh-token
// ─────────────────────────────────────────────────────────
const refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return error(res, "Refresh token required", 400);

    let decoded;
    try {
      decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    } catch (e) {
      return error(
        res,
        "Invalid or expired refresh token. Please log in again.",
        401,
      );
    }

    const [[u]] = await pool.query(
      `SELECT id, company_id, status FROM users WHERE id = ?`,
      [decoded.userId],
    );
    if (!u || u.status === "inactive" || u.status === "suspended") {
      return error(res, "User not found or inactive", 401);
    }

    const { accessToken, refreshToken: newRefresh } = generateTokens(
      u.id,
      u.company_id,
    );
    return success(
      res,
      { accessToken, refreshToken: newRefresh },
      "Token refreshed",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/forgot-password
// ─────────────────────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return error(res, "Email is required", 400);

    const [[user]] = await pool.query(
      "SELECT id, first_name, last_name, status FROM users WHERE email = ?",
      [email],
    );

    // Always 200 — prevent email enumeration
    if (!user)
      return success(
        res,
        {},
        "If this email is registered, a reset OTP has been sent.",
      );

    if (user.status === "not-verified") {
      return error(
        res,
        "Account not verified. Please complete registration first.",
        403,
      );
    }

    await pool.query(
      `UPDATE registration_codes SET is_used = 1 WHERE user_id = ? AND purpose = 'reset_password' AND is_used = 0`,
      [user.id],
    );

    const otp = generateOtp();
    const now = new Date();
    await pool.query(
      `INSERT INTO registration_codes (id, code, purpose, is_used, user_id, expires_at, created_at)
       VALUES (?, ?, 'reset_password', 0, ?, ?, ?)`,
      [uuidv4(), otp, user.id, new Date(now.getTime() + 60 * 60 * 1000), now],
    );

    await sendPasswordResetEmail({
      to: email,
      name: `${user.first_name} ${user.last_name}`,
      otp,
    }).catch((e) => console.error("Password reset email failed:", e.message));

    return success(
      res,
      {},
      "If this email is registered, a reset OTP has been sent.",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/verify-reset-otp
// ─────────────────────────────────────────────────────────
const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return error(res, "email and otp are required", 400);

    const [[user]] = await pool.query("SELECT id FROM users WHERE email = ?", [
      email,
    ]);
    if (!user) return error(res, "Invalid request", 400);

    const [codes] = await pool.query(
      `SELECT id FROM registration_codes
       WHERE code = ? AND user_id = ? AND purpose = 'reset_password'
         AND is_used = 0 AND expires_at > NOW()`,
      [otp, user.id],
    );
    if (!codes.length) return error(res, "Invalid or expired OTP", 400);

    const resetToken = jwt.sign(
      { userId: user.id, purpose: "reset_password" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    await pool.query("UPDATE registration_codes SET is_used = 1 WHERE id = ?", [
      codes[0].id,
    ]);

    return success(
      res,
      { reset_token: resetToken },
      "OTP verified. Use the reset_token to set your new password.",
    );
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// POST /auth/reset-password
// ─────────────────────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { reset_token, new_password } = req.body;
    if (!reset_token || !new_password)
      return error(res, "reset_token and new_password are required", 400);
    if (new_password.length < 7)
      return error(res, "Password must be at least 7 characters", 400);

    let decoded;
    try {
      decoded = jwt.verify(reset_token, process.env.JWT_SECRET);
    } catch (e) {
      return error(
        res,
        "Reset token is invalid or has expired. Please request a new OTP.",
        400,
      );
    }

    if (decoded.purpose !== "reset_password")
      return error(res, "Invalid reset token", 400);

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?",
      [hash, decoded.userId],
    );

    return success(res, {}, "Password reset successfully. You can now log in.");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────────────────
const getMe = async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      `SELECT 
          u.id,
          u.public_id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.role,
          u.status,
          u.company_id,
          u.company_name,
          u.trading_name,
          u.email_verified_at,
          u.last_login_at,

          c.company_name AS reg_company_name,
          c.trading_name AS reg_trading_name,
          c.business_email,
          c.business_phone,
          c.logo_url,
          c.status AS company_status,
          c.firs_enabled,
          c.generate_payment_link,
          c.display_bank_details_on_invoice,
          c.auto_submit_to_firs,
          c.tax_identification_number,
          c.rc_number,
          c.business_type,
          c.city,
          c.state,
          c.country,
          c.lga,

          c.nrs_businessid_test,
          c.nrs_businessid_live,
          c.nrs_apikey,
          c.nrs_apisecret,
          c.nrs_entityid,
          c.nrs_publickey,
          c.nrs_certificate

       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`,
      [req.user.id],
    );

    if (!row) {
      return error(res, "User not found", 404);
    }

    return success(res, {
      ...row,
      company_name: row.reg_company_name || row.company_name,
      trading_name: row.reg_trading_name || row.trading_name,
    });
  } catch (err) {
    next(err);
  }
};
// ─────────────────────────────────────────────────────────
// PATCH /auth/me
// ─────────────────────────────────────────────────────────
const updateMe = async (req, res, next) => {
  try {
    const allowed = ["first_name", "last_name", "phone"];
    const sets = allowed
      .filter((k) => req.body[k] !== undefined)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = allowed
      .filter((k) => req.body[k] !== undefined)
      .map((k) => req.body[k]);

    if (!sets) return error(res, "No valid fields to update", 400);

    values.push(req.user.id);
    await pool.query(
      `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = ?`,
      values,
    );

    return success(res, {}, "Profile updated");
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────
// PATCH /auth/change-password
// ─────────────────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return error(res, "current_password and new_password are required", 400);
    if (new_password.length < 7)
      return error(res, "New password must be at least 7 characters", 400);

    const [[u]] = await pool.query(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.user.id],
    );
    const valid = await bcrypt.compare(current_password, u.password_hash);
    if (!valid) return error(res, "Current password is incorrect", 400);

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query(
      "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?",
      [hash, req.user.id],
    );

    return success(res, {}, "Password changed successfully");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  login,
  logout,
  refreshToken,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  getMe,
  updateMe,
  changePassword,
};
