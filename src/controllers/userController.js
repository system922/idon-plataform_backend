// ========== backend/controllers/userController.js ==========

import bcrypt from 'bcrypt';
import * as userModel from '../models/User.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { validateUserUniqueness } from '../middleware/validateUserUniqueness.js';

// LISTAR USUARIOS
export async function getUsers(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const users = await userModel.findAllUsers(schema);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// UNO
export async function getUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const user = await userModel.findUserById(schema, id);
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// CREAR - ✅ CON VALIDACIÓN
export async function createUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { email, password, first_name, last_name, role_id, is_active } = req.body;
    
    if (!email || !password || !role_id) {
      return res.status(400).json({ error: 'Email, contraseña y rol son requeridos' });
    }

    // ✅ 1. VALIDAR UNICIDAD DEL EMAIL
    const uniquenessCheck = await validateUserUniqueness(email, schema);
    if (uniquenessCheck.exists) {
      return res.status(409).json({
        error: 'Email ya registrado',
        message: uniquenessCheck.message,
        details: {
          source: uniquenessCheck.source,
          schema: uniquenessCheck.schema || null,
          businessName: uniquenessCheck.businessName || null
        }
      });
    }

    // ✅ 2. Verificar que el rol existe en el esquema
    const roleCheck = await userModel.findRoleById(schema, role_id);
    if (!roleCheck) {
      return res.status(400).json({ error: 'El rol seleccionado no existe' });
    }

    // ✅ 3. Crear el usuario
    const password_hash = await bcrypt.hash(password, 12);

    const user = await userModel.createUser(schema, {
      email,
      password_hash,
      first_name: first_name || '',
      last_name: last_name || '',
      role_id,
      is_active: typeof is_active === 'boolean' ? is_active : true
    });

    // ✅ 4. Registrar en business_users (relación con el negocio)
    const businessId = req.user?.businessId;
    if (businessId) {
      await userModel.createBusinessUser({
        user_id: user.id,
        business_id: businessId,
        role_id: role_id,
        is_active: true,
        is_owner: false
      });
    }

    res.status(201).json({ user, message: 'Usuario creado exitosamente' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El correo ya existe en este negocio' });
    }
    console.error('Error creando usuario:', err);
    res.status(500).json({ error: err.message });
  }
}

// ACTUALIZAR - ✅ CON VALIDACIÓN
export async function updateUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { id } = req.params;
    const { first_name, last_name, password, role_id, is_active, email } = req.body;

    // ✅ 1. Verificar que el usuario existe
    const existingUser = await userModel.findUserById(schema, id);
    if (!existingUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // ✅ 2. Si el email cambia, validar unicidad
    if (email && email !== existingUser.email) {
      const uniquenessCheck = await validateUserUniqueness(email, schema);
      if (uniquenessCheck.exists) {
        return res.status(409).json({
          error: 'Email ya registrado',
          message: uniquenessCheck.message,
          details: {
            source: uniquenessCheck.source,
            schema: uniquenessCheck.schema || null,
            businessName: uniquenessCheck.businessName || null
          }
        });
      }
    }

    // ✅ 3. Si se cambia el rol, verificar que existe
    if (role_id) {
      const roleCheck = await userModel.findRoleById(schema, role_id);
      if (!roleCheck) {
        return res.status(400).json({ error: 'El rol seleccionado no existe' });
      }
    }

    let password_hash;
    if (password) {
      password_hash = await bcrypt.hash(password, 12);
    }

    const user = await userModel.updateUser(
      schema,
      id,
      {
        first_name,
        last_name,
        email,
        role_id,
        is_active,
        password: password_hash
      }
    );

    if (!user) return res.status(404).json({ error: 'No encontrado' });
    
    res.json({ user, message: 'Usuario actualizado exitosamente' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El correo ya existe' });
    }
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: err.message });
  }
}

// ELIMINAR (borrado suave)
export async function deleteUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    
    // Verificar que el usuario existe
    const existingUser = await userModel.findUserById(schema, id);
    if (!existingUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await userModel.deleteUser(schema, id);
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    
    res.json({ ok: true, message: 'Usuario eliminado exitosamente' });
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    res.status(500).json({ error: err.message });
  }
}