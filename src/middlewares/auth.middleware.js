const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "Access token required" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [[user]] = await pool.query(
      "SELECT id, email, company_id, role, status FROM users WHERE id = ?",
      [decoded.userId],
    );

    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "User not found" });

    if (user.status === "not-verified") {
      return res
        .status(403)
        .json({ success: false, message: "Email not verified" });
    }
    if (user.status === "inactive" || user.status === "suspended") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Account is inactive or suspended. Contact support.",
        });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};

module.exports = { authenticate };
