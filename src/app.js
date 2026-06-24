require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { testConnection } = require("./config/db");
const { errorHandler, notFound } = require("./middlewares/error.middleware");

// Routes
const authRoutes = require("./routes/auth.routes");
const companyRoutes = require("./routes/company.routes");
const customerRoutes = require("./routes/customer.routes");
const supplierRoutes = require("./routes/supplier.routes");
const productRoutes = require("./routes/product.routes");
const salesInvoiceRoutes = require("./routes/salesInvoice.routes");
const purchaseInvoiceRoutes = require("./routes/purchaseInvoice.routes");
const firsRoutes = require("./routes/firs.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const miscRoutes = require("./routes/misc.routes");
const receiptRoutes = require("./routes/receipt.routes");

const app = express();

// The production app runs behind the hosting provider's reverse proxy.
// Trust one proxy hop by default in production so req.ip and rate limiting
// use the real client address from X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined) {
  const numericTrustProxy = Number(trustProxy);
  const parsedTrustProxy =
    trustProxy === "true"
      ? true
      : trustProxy === "false"
        ? false
        : Number.isNaN(numericTrustProxy)
          ? trustProxy
          : numericTrustProxy;

  app.set("trust proxy", parsedTrustProxy);
} else {
  app.set("trust proxy", 1);
}

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    credentials: true,
  }),
);

// app.use(
//   "/api",
//   rateLimit({
//     windowMs: 60 * 1000, // 1 min
//     max: 200,
//     message: { success: false, message: "Rate limit exceeded." },
//   }),
// );

// ── Paystack webhook needs raw body ───────────────────────
app.use(
  "/api/payments/paystack/webhook",
  express.raw({ type: "application/json" }),
);

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Logging ───────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// ── Health check ──────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "PayTraka API",
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────
const API = "/api";

app.use(`${API}/auth`, authRoutes);
app.use(`${API}/companies`, companyRoutes);
app.use(`${API}/customers`, customerRoutes);
app.use(`${API}/suppliers`, supplierRoutes);
app.use(`${API}/products`, productRoutes);
app.use(`${API}/sales-invoices`, salesInvoiceRoutes);
app.use(`${API}/purchase-invoices`, purchaseInvoiceRoutes);
app.use(`${API}/firs`, firsRoutes);
app.use(`${API}/payments`, subscriptionRoutes);
app.use(`${API}/receipts`, receiptRoutes);

// ── 404 & Error handlers ──────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const start = async () => {
  if (app.locals.server?.listening) {
    return app.locals.server;
  }

  await testConnection();
  app.locals.server = app.listen(PORT, () => {
    console.log(
      `🚀 PayTraka API running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
    );
  });

  return app.locals.server;
};

if (require.main === module) {
  start().catch((err) => {
    console.error("❌ Failed to start PayTraka API:", err);
    process.exit(1);
  });
}

module.exports = app;
module.exports.start = start;
