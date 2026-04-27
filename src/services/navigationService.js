import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const toSlug = (str = '') =>
  str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

// ----------------------
// Nivel 2: Menu normal
// ----------------------
export const getNavigationMenu = async (businessId, userId) => {
  try {
    // Get user's role in the business
    const roleResult = await query(
      `SELECT r.id as role_id, r.code as role_code, r.name as role_name
       FROM public.business_users bu
       JOIN public.roles r ON bu.role_id = r.id
       WHERE bu.business_id = $1 AND bu.user_id = $2`,
      [businessId, userId]
    );

    if (roleResult.rows.length === 0) {
      throw new Error('User not associated with this business');
    }

    const { role_id, role_code, role_name } = roleResult.rows[0];

    // Get active modules for the business
    const modulesResult = await query(
      `SELECT m.id, m.code, m.name, m.icon, m.sort_order
       FROM public.business_modules bm
       JOIN public.modules m ON bm.module_id = m.id
       WHERE bm.business_id = $1 AND bm.is_active = true
       ORDER BY m.sort_order ASC`,
      [businessId]
    );

    const modules = modulesResult.rows;

    // Build menu structure
    const menu = [];

    for (const module of modules) {
      // Get active features for this module and business
      const featuresResult = await query(
        `SELECT f.id, f.code, f.name, f.description
         FROM public.business_features bf
         JOIN public.features f ON bf.feature_id = f.id
         WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
         ORDER BY f.name ASC`,
        [businessId, module.id]
      );

      const features = featuresResult.rows;

      // Build menu pages from features
      const pages = features.map(feature => ({
        id: feature.id,
        code: feature.code,
        name: feature.name,
        path: `/${module.code}/${toSlug(feature.name)}`,
        icon: null,
        permissions: {
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: role_code === 'admin',
        },
      }));

      if (pages.length > 0) {
        menu.push({
          id: module.id,
          code: module.code,
          name: module.name,
          icon: module.icon,
          pages,
        });
      }
    }

    return {
      role: {
        id: role_id,
        code: role_code,
        name: role_name,
      },
      modules: menu,
    };
  } catch (error) {
    logger.error('Error building navigation menu:', error);
    throw error;
  }
};

// ----------------------
// Nivel 3: Menu filtrado por schema y permissions JSONB
// ----------------------
/**
 * businessId: public.businesses.id
 * userId:     id en el esquema (por ejemplo, en tenant_prueba_final.users)
 * schema:     nombre del esquema correspondiente al negocio (ej: tenant_prueba_final)
 */
export const getNavigationMenuLevel3 = async (businessId, userId, schema) => {
  try {
    logger.info(`[MENU-L3] businessId=${businessId}, userId=${userId}, schema=${schema}`);

    // Rol del usuario y permisos en el schema
    const userRoleRes = await query(
      `SELECT u.role_id, r.name as role_name, r.permissions
        FROM ${schema}.users u
        JOIN ${schema}.roles r ON u.role_id = r.id
       WHERE u.id = $1`, [userId]
    );
    if (!userRoleRes.rows.length) {
      logger.warn(`[MENU-L3] Usuario/rol NO encontrado en schema`);
      throw new Error('User/Role not found in schema');
    }

    const { role_id, role_name, permissions } = userRoleRes.rows[0];
    logger.info(`[MENU-L3] Rol: ${role_name} (role_id=${role_id})`);
    logger.info(`[MENU-L3] Permissions JSON extraído:\n${permissions}`);

    let perms = [];
    try {
      perms = typeof permissions === 'string' ? JSON.parse(permissions) : permissions || [];
    } catch (e) {
      logger.warn('[MENU-L3] Error al parsear permissions JSON:', e);
      perms = [];
    }
    logger.info(`[MENU-L3] Permissions parseados: ${JSON.stringify(perms, null, 2)}`);

    // Módulos activos en el negocio (public)
    const modulesResult = await query(
      `SELECT m.id, m.code, m.name, m.icon, m.sort_order 
         FROM public.business_modules bm
         JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order ASC`, [businessId]
    );
    const modules = modulesResult.rows;
    logger.info(`[MENU-L3] Módulos activos del negocio: ${modules.length} encontrados`);
    modules.forEach(m => logger.info(`[MENU-L3]   - ${m.name} (id=${m.id}, code=${m.code})`));

    // Armado final de menú
    const menu = [];
    for (const permiso of perms) {
      const module = modules.find(m => m.id === permiso.modulo || m.code === permiso.modulo);
      if (!module) continue;

      // Buscar todas las features (funcionalidades) de ese módulo -- solo si existen y son permitidas
      const featuresResult = await query(
        `SELECT f.id, f.code, f.name, f.description
           FROM public.features f
          WHERE f.module_id = $1`,
        [module.id]
      );
      const allowedFeatures = featuresResult.rows.filter(
        f => (permiso.features || []).includes(f.id) || (permiso.features || []).includes(f.code)
      );
      if (!allowedFeatures.length) continue;

      // Armar menú para este módulo
      menu.push({
        id: module.id,
        code: module.code,
        name: module.name,
        icon: module.icon,
        pages: allowedFeatures.map(feature => ({
          id: feature.id,
          code: feature.code,
          name: feature.name,
          description: feature.description,
          path: `/${module.code}/${toSlug(feature.name)}`,
          icon: null,
          permissions: {
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: false // Cambia según tu lógica!
          }
        }))
      });
    }

    logger.info(`[MENU-L3] >>> MENÚ FINAL ARMADO (modulos): ${menu.length}`);
    menu.forEach(m => logger.info(`[MENU-L3-MOD] ${m.name} -> ${m.pages.map(p => p.name).join(', ')}`));

    return {
      role: { id: role_id, name: role_name },
      modules: menu,
    };
  } catch (error) {
    logger.error('Error building navigation menu for level 3:', error);
    throw error;
  }
};

export const getBusinessInfo = async (businessId) => {
  try {
    const result = await query(
      `SELECT b.id, b.slug, b.name, b.is_active, b.is_verified,
              bt.code as type_code, bt.name as type_name,
              s.status as subscription_status, s.amount_monthly, s.amount_annual
       FROM public.businesses b
       JOIN public.business_types bt ON b.business_type_id = bt.id
       LEFT JOIN public.subscriptions s ON b.id = s.business_id
       WHERE b.id = $1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      throw new Error('Business not found');
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error fetching business info:', error);
    throw error;
  }
};

export const getBusinessModules = async (businessId) => {
  try {
    const result = await query(
      `SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual, m.icon,
              bm.is_active, bm.activated_at
       FROM public.business_modules bm
       JOIN public.modules m ON bm.module_id = m.id
       WHERE bm.business_id = $1
       ORDER BY m.sort_order ASC`,
      [businessId]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error fetching business modules:', error);
    throw error;
  }
};

export const getBusinessModulesWithFeatures = async (businessId) => {
  try {
    const modulesResult = await query(
      `SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual, m.icon,
              bm.is_active, bm.activated_at, m.sort_order
       FROM public.business_modules bm
       JOIN public.modules m ON bm.module_id = m.id
       WHERE bm.business_id = $1 AND bm.is_active = true
       ORDER BY m.sort_order ASC`,
      [businessId]
    );
    const modules = modulesResult.rows;
    for (const module of modules) {
      const featuresResult = await query(
        `SELECT f.id, f.code, f.name, f.description, f.is_premium
         FROM public.business_features bf
         JOIN public.features f ON bf.feature_id = f.id
         WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
         ORDER BY f.name ASC`,
        [businessId, module.id]
      );
      module.features = featuresResult.rows.map(f => ({
        id: f.id,
        code: f.code,
        name: f.name,
        description: f.description,
        is_premium: f.is_premium
      }));
    }
    return modules;
  } catch (error) {
    logger.error('Error fetching business modules with features:', error);
    throw error;
  }
};