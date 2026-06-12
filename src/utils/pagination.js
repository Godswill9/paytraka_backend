const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildSearch = (fields, searchTerm) => {
  if (!searchTerm) return { clause: '', values: [] };
  const clause = fields.map((f) => `${f} LIKE ?`).join(' OR ');
  const values = fields.map(() => `%${searchTerm}%`);
  return { clause: `(${clause})`, values };
};

module.exports = { getPagination, buildSearch };
