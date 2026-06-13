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

// ── Security ──────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    credentials: true,
  }),
);

// ── Rate limiting ─────────────────────────────────────────
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    message: {
      success: false,
      message: "Too many requests, please try again later.",
    },
  }),
);

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 200,
    message: { success: false, message: "Rate limit exceeded." },
  }),
);

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
app.use(`${API}/firs`, firsRoutes);
app.use(`${API}/payments`, subscriptionRoutes);
app.use(`${API}/receipts`, receiptRoutes);

// ── 404 & Error handlers ──────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const start = async () => {
  await testConnection();
  app.listen(PORT, () => {
    console.log(
      `🚀 PayTraka API running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
    );
  });
};

start();

module.exports = app;
