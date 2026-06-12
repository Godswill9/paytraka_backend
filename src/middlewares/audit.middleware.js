const { pool } = require('../config/db');

const audit = async ({ userId, companyId, action, entity, entityId, details, req }) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, company_id, action, entity, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        companyId || null,
        action,
        entity || null,
        entityId || null,
        details ? JSON.stringify(details) : null,
        req?.ip || null,
        req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
};

module.exports = { audit };
