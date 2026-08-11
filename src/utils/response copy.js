export const successResponse = (data, message = 'Success', statusCode = 200) => ({
  success: true,
  statusCode,
  message,
  data,
});

export const errorResponse = (message, statusCode = 500, errors = null) => ({
  success: false,
  statusCode,
  message,
  errors,
});

export const paginatedResponse = (data, total, page, pageSize, message = 'Success') => ({
  success: true,
  message,
  data,
  pagination: {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  },
});
