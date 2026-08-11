import { verifyToken } from '../services/authService.js';
import { errorResponse } from '../utils/response.js';

export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(errorResponse('Authorization token required', 401));
    }

    const token   = authHeader.slice(7);
    const decoded = verifyToken(token);

    req.user = {
      userId:     decoded.userId     || decoded.id,
      businessId: decoded.businessId || req.headers['x-business-id'],
      schemaName: decoded.schemaName || req.headers['x-db-name'],
      roleCode:   decoded.roleCode,
      role:       decoded.role,
      userType:   decoded.userType,
      email:      decoded.email,
      firstName:  decoded.firstName,
      lastName:   decoded.lastName,
    };

    next();
  } catch (error) {
    res.status(401).json(errorResponse(error.message, 401));
  }
};

export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token   = authHeader.slice(7);
      const decoded = verifyToken(token);
      req.user = {
        userId:     decoded.userId     || decoded.id,
        businessId: decoded.businessId || req.headers['x-business-id'],
        schemaName: decoded.schemaName || req.headers['x-db-name'],
        roleCode:   decoded.roleCode,
        role:       decoded.role,
        userType:   decoded.userType,
        email:      decoded.email,
        firstName:  decoded.firstName,
        lastName:   decoded.lastName,
      };
    }
    next();
  } catch {
    next();
  }
};

export const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required', 401));
  }

  const isAdmin =
    req.user.roleCode === 'admin'        ||
    req.user.role     === 'super_admin'  ||
    req.user.userType === 'admin_idon';

  if (!isAdmin) {
    return res.status(403).json(errorResponse('Admin access required', 403));
  }

  next();
};

export const businessContextMiddleware = (req, res, next) => {
  // Admin platform routes never require a business context
  if (req.path.startsWith('/admin') || req.originalUrl.includes('/api/admin')) {
    return next();
  }

  if (!req.user || !req.user.businessId) {
    return res.status(400).json(errorResponse('Business context required', 400));
  }

  req.schema = req.headers['x-db-name'] || req.user.schemaName || null;

  if (!req.schema) {
    return res.status(400).json(errorResponse('Schema name required', 400));
  }

  next();
};