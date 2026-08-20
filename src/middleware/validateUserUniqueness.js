import { query } from '../config/database.js';

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

export const validateUniqueEmail = async (req, res, next) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Email es requerido' 
    });
  }

  try {
    const schema = req.schema;
    if (!schema) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Business context required' 
      });
    }
    
    // Para PUT, excluir el ID del usuario que se está editando
    const excludeUserId = req.params.id || null;
    
    const result = await validateUserUniqueness(email, schema, excludeUserId);
    
    if (result.exists) {
      return res.status(409).json({
        ok: false,
        error: 'Email ya registrado',
        message: result.message,
        details: {
          source: result.source,
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