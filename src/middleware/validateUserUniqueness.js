import { query } from '../config/database.js';

/**
 * Verifica si un email ya existe en public.users o en el esquema actual
 * 
 * @param {string} email - Email a verificar
 * @param {string} schema - Esquema del negocio actual
 * @param {string} excludeUserId - ID del usuario a excluir (opcional, para ediciones)
 */
export const validateUserUniqueness = async (email, schema, excludeUserId = null) => {
  // 1. Verificar en public.users
  let publicQuery = `SELECT id FROM public.users WHERE email = $1`;
  let publicParams = [email];
  
  if (excludeUserId) {
    publicQuery += ` AND id::text != $2`;
    publicParams.push(excludeUserId);
  }
  
  const publicUser = await query(publicQuery, publicParams);
  
  if (publicUser.rows.length > 0) {
    return {
      exists: true,
      source: 'public',
      message: `El email "${email}" ya está registrado como usuario principal del sistema.`
    };
  }

  // 2. Verificar en el esquema actual del negocio
  let schemaQuery = `SELECT id FROM "${schema}".users WHERE email = $1`;
  let schemaParams = [email];
  
  if (excludeUserId) {
    schemaQuery += ` AND id::text != $2`;
    schemaParams.push(excludeUserId);
  }
  
  const userInSchema = await query(schemaQuery, schemaParams);
  
  if (userInSchema.rows.length > 0) {
    // Obtener nombre del negocio
    let businessName = null;
    const businessRes = await query(
      `SELECT name FROM public.businesses WHERE schema_name = $1`,
      [schema]
    );
    if (businessRes.rows.length > 0) {
      businessName = businessRes.rows[0].name;
    }

    return {
      exists: true,
      source: 'schema',
      businessName: businessName,
      message: businessName 
        ? `El email "${email}" ya está registrado como colaborador/a en el negocio "${businessName}".`
        : `El email "${email}" ya está registrado como colaborador/a en este negocio.`
    };
  }

  return { exists: false };
};