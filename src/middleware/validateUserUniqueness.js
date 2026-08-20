// ========== backend/middleware/validateUserUniqueness.js ==========

import { query } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Verifica que un email no exista en el esquema actual o en public.users
 * 
 * @param {string} email - Email a verificar
 * @param {string} schema - Esquema del negocio actual
 * @param {string} excludeUserId - ID del usuario a excluir (opcional, para ediciones)
 */
export const validateUserUniqueness = async (email, schema, excludeUserId = null) => {
  // Validar que schema existe
  if (!schema) {
    return { exists: false };
  }

  // 1. Verificar en public.users (dueños/usuarios principales)
  try {
    let publicQuery = `SELECT id, email, first_name, last_name FROM public.users WHERE email = $1`;
    let publicParams = [email];
    let paramIndex = 2;
    
    if (excludeUserId) {
      publicQuery += ` AND id::text != $${paramIndex}`;
      publicParams.push(excludeUserId);
      paramIndex++;
    }
    
    const publicUser = await query(publicQuery, publicParams);
    
    if (publicUser.rows.length > 0) {
      return {
        exists: true,
        source: 'public',
        user: publicUser.rows[0],
        message: `El email "${email}" ya está registrado como usuario principal del sistema.`
      };
    }
  } catch (err) {
    console.error('Error verificando en public.users:', err);
  }

  // 2. Verificar SOLO en el esquema actual del negocio
  try {
    // Verificar que la tabla existe
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'users'
      )
    `, [schema]);

    if (!tableCheck.rows[0]?.exists) {
      return { exists: false };
    }

    let schemaQuery = `SELECT id, email, first_name, last_name 
                       FROM "${schema}".users 
                       WHERE email = $1`;
    let schemaParams = [email];
    let paramIndex = 2;
    
    // Si se especifica un usuario a excluir (edición), excluirlo de la validación
    if (excludeUserId) {
      schemaQuery += ` AND id::text != $${paramIndex}`;
      schemaParams.push(excludeUserId);
      paramIndex++;
    }
    
    const userInSchema = await query(schemaQuery, schemaParams);
    
    if (userInSchema.rows.length > 0) {
      // Obtener el nombre del negocio
      let businessName = null;
      try {
        const businessRes = await query(
          `SELECT name FROM public.businesses WHERE schema_name = $1`,
          [schema]
        );
        if (businessRes.rows.length > 0) {
          businessName = businessRes.rows[0].name;
        }
      } catch (err) {
        console.error('Error obteniendo nombre del negocio:', err);
      }

      return {
        exists: true,
        source: 'schema',
        schema: schema,
        businessName: businessName,
        user: userInSchema.rows[0],
        message: businessName 
          ? `El email "${email}" ya está registrado como colaborador/a en el negocio "${businessName}".`
          : `El email "${email}" ya está registrado como colaborador/a en este negocio.`
      };
    }
  } catch (err) {
    console.error('Error verificando en esquema:', err);
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
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Business context required' 
      });
    }
    
    const result = await validateUserUniqueness(email, schema);
    
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
      error: 'Error validando email',
      message: error.message 
    });
  }
};