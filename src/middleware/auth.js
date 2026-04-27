import { verifyToken } from '../services/authService.js';
import { errorResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    logger.info(`[AUTH] Header: ${authHeader}`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('[AUTH] No Authorization token provided');
      return res.status(401).json(errorResponse('Authorization token required', 401));
    }

    const token   = authHeader.slice(7);
    const decoded = verifyToken(token);
    logger.info('[AUTH] Token decodificado:', decoded);

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

    logger.info('[AUTH] req.user final generado:', req.user);
    next();
  } catch (error) {
    logger.error('[AUTH] Authentication error:', error.message);
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
  } catch (error) {
    logger.warn('Optional authentication failed:', error.message);
    next();
  }
};

export const adminMiddleware = (req, res, next) => {
  logger.info('[ADMIN] Verificando acceso admin. req.user:', req.user);
  if (!req.user) {
    return res.status(401).json(errorResponse('Authentication required', 401));
  }

  const isAdmin =
    req.user.roleCode === 'admin'        ||
    req.user.role     === 'super_admin'  ||
    req.user.userType === 'admin_idon';

  if (!isAdmin) {
    logger.warn('[ADMIN] Acceso denegado.');
    return res.status(403).json(errorResponse('Admin access required', 403));
  }

  next();
};

export const businessContextMiddleware = (req, res, next) => {
  logger.info('[BUSINESS] Verificando contexto de negocio. req.user:', req.user);

  if (!req.user || !req.user.businessId) {
    logger.warn('[BUSINESS] Falta contexto de negocio en req.user');
    return res.status(400).json(errorResponse('Business context required', 400));
  }

  req.schema = req.headers['x-db-name'] || req.user.schemaName || null;

  if (!req.schema) {
    logger.warn('[BUSINESS] No se pudo resolver schema name');
    return res.status(400).json(errorResponse('Schema name required', 400));
  }

  logger.info(`[BUSINESS] req.schema seteado: ${req.schema}`);
  next();
};