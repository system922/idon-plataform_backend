import { errorResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  if (err.message.includes('duplicate key')) {
    return res.status(409).json(errorResponse('Resource already exists', 409));
  }

  if (err.message.includes('violates foreign key')) {
    return res.status(400).json(errorResponse('Invalid reference', 400));
  }

  res.status(500).json(errorResponse('Internal server error', 500));
};

export const notFoundHandler = (req, res) => {
  res.status(404).json(errorResponse('Route not found', 404));
};
