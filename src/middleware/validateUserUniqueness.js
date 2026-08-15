// ========== backend/middleware/validateUserUniqueness.js ==========

import { query } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Verifica que un email no exista en ninguna fuente:
 * 1. public.users (dueños/usuarios principales)
 * 2. Cualquier esquema de negocio (empleados)
 */
export const validateUserUniqueness = async (email, excludeSchema = null) => {
  // 1. Verificar en public.users
  const publicUser = await query(
    `SELECT id, email, first_name, last_name FROM public.users WHERE email = $1`,
    [email]
  );
  
  if (publicUser.rows.length > 0) {
    return {
      exists: true,
      source: 'public',
      user: publicUser.rows[0],
      message: `El email "${email}" ya está registrado como usuario principal.`
    };
  }

  // 2. Buscar en todos los esquemas activos
  const schemas = await query(
    `SELECT schema_name, name FROM public.businesses WHERE is_active = TRUE`
  );

  for (const schema of schemas.rows) {
    if (excludeSchema && schema.schema_name === excludeSchema) continue;
    
    try {
      const userInSchema = await query(
        `SELECT id, email, first_name, last_name 
         FROM "${schema.schema_name}".users 
         WHERE email = $1`,
        [email]
      );
      
      if (userInSchema.rows.length > 0) {
        return {
          exists: true,
          source: 'schema',
          schema: schema.schema_name,
          businessName: schema.name,
          user: userInSchema.rows[0],
          message: `El email "${email}" ya está registrado como empleado en el negocio "${schema.name}".`
        };
      }
    } catch (err) {
      // Si el esquema no existe o hay error, continuar
      continue;
    }
  }

  return { exists: false };
};

/**
 * Middleware para validar unicidad de email en creación de usuarios
 */
export const validateUniqueEmail = async (req, res, next) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Email es requerido' 
    });
  }

  try {
    const result = await validateUserUniqueness(email);
    
    if (result.exists) {
      return res.status(409).json({
        ok: false,
        error: 'Email ya registrado',
        message: result.message,
        details: {
          source: result.source,
          schema: result.schema || null,
          businessName: result.businessName || null
        }
      });
    }
    
    next();
  } catch (error) {
    console.error('Error validando email:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Error validando email' 
    });
  }
};