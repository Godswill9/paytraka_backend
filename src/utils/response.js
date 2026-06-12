const success = (res, data = {}, message = "Success", statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const created = (res, data = {}, message = "Created successfully") => {
  return success(res, data, message, 201);
};

const error = (
  res,
  message = "Something went wrong",
  statusCode = 500,
  errors = null,
) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(statusCode).json(payload);
};

const paginate = (res, data, total, page, limit, message = "Success") => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    },
  });
};

module.exports = { success, created, error, paginate };
