const { pool } = require("../config/db");

let auditColumnsPromise;

const getAuditColumns = async () => {
  if (!auditColumnsPromise) {
    auditColumnsPromise = pool
      .query("SHOW COLUMNS FROM audit_logs")
      .then(([rows]) => new Set(rows.map(({ Field }) => Field)))
      .catch((err) => {
        auditColumnsPromise = undefined;
        throw err;
      });
  }

  return auditColumnsPromise;
};

const firstExistingColumn = (columns, candidates) =>
  candidates.find((column) => columns.has(column));

const audit = async ({
  userId,
  companyId,
  action,
  entity,
  entityId,
  details,
  req,
}) => {
  try {
    const availableColumns = await getAuditColumns();
    const valuesByColumn = new Map([
      ["user_id", userId || null],
      ["company_id", companyId || null],
      ["action", action],
      [
        firstExistingColumn(availableColumns, [
          "entity",
          "entity_type",
          "resource_type",
        ]),
        entity || null,
      ],
      [
        firstExistingColumn(availableColumns, [
          "entity_id",
          "resource_id",
          "record_id",
        ]),
        entityId || null,
      ],
      [
        firstExistingColumn(availableColumns, ["details", "metadata"]),
        details ? JSON.stringify(details) : null,
      ],
      [
        firstExistingColumn(availableColumns, ["ip_address", "ip"]),
        req?.ip || null,
      ],
      [
        firstExistingColumn(availableColumns, ["user_agent"]),
        req?.headers?.["user-agent"] || null,
      ],
    ]);

    const entries = [...valuesByColumn].filter(
      ([column]) => column && availableColumns.has(column),
    );

    if (!entries.length) {
      throw new Error("audit_logs has no supported columns");
    }

    const columnSql = entries.map(([column]) => `\`${column}\``).join(", ");
    const placeholders = entries.map(() => "?").join(", ");

    await pool.query(
      `INSERT INTO audit_logs (${columnSql}) VALUES (${placeholders})`,
      entries.map(([, value]) => value),
    );
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};

module.exports = { audit };
