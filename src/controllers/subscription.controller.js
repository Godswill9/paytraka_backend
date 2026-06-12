const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { success, created, error } = require('../utils/response');
const { paystackRequest } = require('../config/paystack');

// GET /subscription-plans
const getPlans = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price ASC');
    return success(res, rows);
  } catch (err) { next(err); }
};

// GET /subscription-plans/:id
const getPlan = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM subscription_plans WHERE id = ?', [req.params.id]);
    if (!rows.length) return error(res, 'Plan not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// GET /companies/:id/subscription
const getSubscription = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT cs.*, sp.name as plan_name, sp.price, sp.billing_cycle, sp.features
       FROM company_subscriptions cs
       LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
       WHERE cs.company_id = ?`,
      [req.user.company_id]
    );
    return success(res, rows[0] || null);
  } catch (err) { next(err); }
};

// POST /payments/initialize-subscription
const initializeSubscription = async (req, res, next) => {
  try {
    const { plan_id } = req.body;
    const mode = req.body.mode || 'live'; // subscription is always live

    const [plans] = await pool.query('SELECT * FROM subscription_plans WHERE id = ?', [plan_id]);
    if (!plans.length) return error(res, 'Plan not found', 404);

    const [users] = await pool.query('SELECT email FROM users WHERE id = ?', [req.user.id]);
    const plan = plans[0];
    const paystack = paystackRequest(mode);

    const ref = `SUB-${uuidv4()}`;
    const initRes = await paystack.post('/transaction/initialize', {
      email: users[0].email,
      amount: plan.price * 100, // kobo
      reference: ref,
      callback_url: `${process.env.APP_URL}/payments/paystack/callback`,
      metadata: {
        company_id: req.user.company_id,
        plan_id,
        user_id: req.user.id,
      },
    });

    return success(res, {
      authorization_url: initRes.data.data.authorization_url,
      reference: ref,
    }, 'Subscription initialized');
  } catch (err) { next(err); }
};

// GET /payments/paystack/callback
const paystackCallback = async (req, res, next) => {
  try {
    const { reference } = req.query;
    const mode = 'live';

    const paystack = paystackRequest(mode);
    const verifyRes = await paystack.get(`/transaction/verify/${reference}`);
    const txData = verifyRes.data.data;

    if (txData.status !== 'success') {
      return res.redirect(`${process.env.APP_URL}/subscription/failed`);
    }

    const { company_id, plan_id } = txData.metadata;

    // Upsert subscription
    const [existing] = await pool.query('SELECT id FROM company_subscriptions WHERE company_id = ?', [company_id]);

    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + 1);

    if (existing.length) {
      await pool.query(
        `UPDATE company_subscriptions SET plan_id = ?, status = 'active', start_date = ?, end_date = ?, updated_at = NOW() WHERE company_id = ?`,
        [plan_id, start, end, company_id]
      );
    } else {
      await pool.query(
        `INSERT INTO company_subscriptions (id, company_id, plan_id, status, start_date, end_date) VALUES (?, ?, ?, 'active', ?, ?)`,
        [uuidv4(), company_id, plan_id, start, end]
      );
    }

    // Record payment
    await pool.query(
      `INSERT INTO subscription_payments (id, company_id, reference, amount, status, gateway_response, paid_at)
       VALUES (?, ?, ?, ?, 'success', ?, NOW())`,
      [uuidv4(), company_id, reference, txData.amount / 100, JSON.stringify(txData)]
    );

    return res.redirect(`${process.env.APP_URL}/subscription/success`);
  } catch (err) { next(err); }
};

// POST /payments/paystack/webhook
const paystackWebhook = async (req, res, next) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_LIVE)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).send('Invalid signature');
    }

    const { event, data } = req.body;

    if (event === 'charge.success') {
      const { company_id, plan_id } = data.metadata || {};
      if (company_id && plan_id) {
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        await pool.query(
          `UPDATE company_subscriptions SET status = 'active', end_date = ?, updated_at = NOW() WHERE company_id = ?`,
          [end, company_id]
        );
      }
    }

    if (event === 'subscription.disable') {
      const { company_id } = data.metadata || {};
      if (company_id) {
        await pool.query(
          `UPDATE company_subscriptions SET status = 'cancelled', updated_at = NOW() WHERE company_id = ?`,
          [company_id]
        );
      }
    }

    res.sendStatus(200);
  } catch (err) { next(err); }
};

// PATCH /companies/:id/subscription/cancel
const cancelSubscription = async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE company_subscriptions SET status = 'cancelled', updated_at = NOW() WHERE company_id = ?`,
      [req.user.company_id]
    );
    return success(res, {}, 'Subscription cancelled');
  } catch (err) { next(err); }
};

// GET /subscription-payments
const getSubscriptionPayments = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM subscription_payments WHERE company_id = ? ORDER BY created_at DESC`,
      [req.user.company_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

module.exports = { getPlans, getPlan, getSubscription, initializeSubscription, paystackCallback, paystackWebhook, cancelSubscription, getSubscriptionPayments };
