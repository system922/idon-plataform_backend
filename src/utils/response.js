// ========== backend/utils/response.js ==========

/**
 * Respuesta de éxito estándar
 * @param {any} data - Datos a devolver
 * @param {string} message - Mensaje de éxito
 * @param {number} statusCode - Código de estado HTTP (default: 200)
 * @returns {Object} Respuesta formateada
 */
export const successResponse = (data, message = 'Success', statusCode = 200) => {
  // ✅ Estructura consistente para todas las respuestas exitosas
  return {
    success: true,
    statusCode,
    message,
    data // ✅ Los datos siempre van dentro de 'data'
  };
};

/**
 * Respuesta de error estándar
 * @param {string} message - Mensaje de error
 * @param {number} statusCode - Código de estado HTTP (default: 400)
 * @param {any} errors - Errores adicionales (opcional)
 * @returns {Object} Respuesta de error formateada
 */
export const errorResponse = (message, statusCode = 400, errors = null) => {
  // ✅ Estructura consistente para todas las respuestas de error
  const response = {
    success: false,
    statusCode,
    message
  };

  // ✅ Si hay errores adicionales, incluirlos
  if (errors) {
    response.errors = errors;
  }

  return response;
};

/**
 * Respuesta de éxito con paginación
 * @param {Array} data - Datos paginados
 * @param {Object} pagination - Información de paginación
 * @param {string} message - Mensaje de éxito
 * @returns {Object} Respuesta paginada formateada
 */
export const paginatedResponse = (data, pagination, message = 'Success') => {
  return {
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page || 1,
      limit: pagination.limit || 10,
      total: pagination.total || data.length,
      totalPages: pagination.totalPages || Math.ceil((pagination.total || data.length) / (pagination.limit || 10))
    }
  };
};

/**
 * Respuesta de éxito con metadatos adicionales
 * @param {any} data - Datos a devolver
 * @param {Object} meta - Metadatos adicionales
 * @param {string} message - Mensaje de éxito
 * @returns {Object} Respuesta con metadatos
 */
export const metaResponse = (data, meta = {}, message = 'Success') => {
  return {
    success: true,
    message,
    data,
    meta
  };
};

/**
 * Respuesta de creación (201)
 * @param {any} data - Datos del recurso creado
 * @param {string} message - Mensaje de éxito
 * @returns {Object} Respuesta de creación
 */
export const createdResponse = (data, message = 'Resource created successfully') => {
  return successResponse(data, message, 201);
};

/**
 * Respuesta de actualización (200)
 * @param {any} data - Datos del recurso actualizado
 * @param {string} message - Mensaje de éxito
 * @returns {Object} Respuesta de actualización
 */
export const updatedResponse = (data, message = 'Resource updated successfully') => {
  return successResponse(data, message, 200);
};

/**
 * Respuesta de eliminación (200)
 * @param {string} message - Mensaje de éxito
 * @returns {Object} Respuesta de eliminación
 */
export const deletedResponse = (message = 'Resource deleted successfully') => {
  return successResponse(null, message, 200);
};

/**
 * Respuesta de no contenido (204)
 * @returns {Object} Respuesta sin contenido
 */
export const noContentResponse = () => {
  return {
    success: true,
    statusCode: 204,
    message: 'No content'
  };
};

/**
 * Respuesta de validación fallida (422)
 * @param {Object} errors - Errores de validación
 * @param {string} message - Mensaje de error
 * @returns {Object} Respuesta de validación
 */
export const validationErrorResponse = (errors, message = 'Validation failed') => {
  return errorResponse(message, 422, errors);
};

/**
 * Respuesta de no autorizado (401)
 * @param {string} message - Mensaje de error
 * @returns {Object} Respuesta de no autorizado
 */
export const unauthorizedResponse = (message = 'Unauthorized') => {
  return errorResponse(message, 401);
};

/**
 * Respuesta de prohibido (403)
 * @param {string} message - Mensaje de error
 * @returns {Object} Respuesta de prohibido
 */
export const forbiddenResponse = (message = 'Forbidden') => {
  return errorResponse(message, 403);
};

/**
 * Respuesta de no encontrado (404)
 * @param {string} message - Mensaje de error
 * @returns {Object} Respuesta de no encontrado
 */
export const notFoundResponse = (message = 'Resource not found') => {
  return errorResponse(message, 404);
};

/**
 * Respuesta de conflicto (409)
 * @param {string} message - Mensaje de error
 * @returns {Object} Respuesta de conflicto
 */
export const conflictResponse = (message = 'Conflict') => {
  return errorResponse(message, 409);
};

/**
 * Respuesta de error interno del servidor (500)
 * @param {string} message - Mensaje de error
 * @param {Error} error - Error original (opcional, solo en desarrollo)
 * @returns {Object} Respuesta de error interno
 */
export const serverErrorResponse = (message = 'Internal server error', error = null) => {
  const response = errorResponse(message, 500);
  
  // ✅ Incluir detalles del error solo en desarrollo
  if (process.env.NODE_ENV === 'development' && error) {
    response.details = {
      message: error.message,
      stack: error.stack
    };
  }
  
  return response;
};

/**
 * Formatear respuesta para el cliente
 * @param {Object} result - Resultado de la operación
 * @param {number} statusCode - Código de estado HTTP
 * @returns {Object} Respuesta formateada
 */
export const formatResponse = (result, statusCode = 200) => {
  if (result && result.success === false) {
    return errorResponse(result.message, result.statusCode || statusCode, result.errors);
  }
  
  return successResponse(result.data, result.message, statusCode);
};

// ✅ Exportar todas las funciones como un objeto
export default {
  successResponse,
  errorResponse,
  paginatedResponse,
  metaResponse,
  createdResponse,
  updatedResponse,
  deletedResponse,
  noContentResponse,
  validationErrorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  conflictResponse,
  serverErrorResponse,
  formatResponse
};