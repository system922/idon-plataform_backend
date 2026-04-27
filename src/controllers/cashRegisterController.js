import * as cashService from '../services/cashRegisterService.js';
import { getSchemaName } from '../utils/tenantHelper.js';

// Validar Jefe/a de Caja
export const validateJefaCaja = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { email, clave } = req.body;
    if (!schema) return res.status(400).json({ valid: false, error: 'Schema requerido' });

    const user = await cashService.findUserByEmail(schema, email);
    if (!user) return res.json({ valid: false, error: 'Usuario no válido' });

    const validPass = await cashService.checkPassword(clave, user.password_hash);
    if (!validPass) return res.json({ valid: false, error: 'Clave incorrecta' });

    const role = await cashService.getRoleById(schema, user.role_id);
    if (!role || !['Jefe de Caja', 'Jefa de Caja'].includes(role.name))
      return res.json({ valid: false, error: 'No tiene permisos de Jefe/a de Caja' });

    res.json({ valid: true, userId: user.id, email: user.email });

  } catch (e) {
    res.status(500).json({ valid: false, error: 'Error en servidor', detail: e.message });
  }
};

// Guardar efectivo en caja
export const openEfectivo = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { efectivo, date } = req.body;
    if (!schema) return res.status(400).json({ error: 'Schema requerido' });
    if (typeof efectivo !== "number" || !date)
      return res.status(400).json({ error: 'Datos incompletos' });

    const entry = await cashService.createCashEntry(schema, { efectivo, date });
    res.json(entry);

  } catch (e) {
    res.status(500).json({ error: "Error registrando efectivo", detail: e.message });
  }
};

// Guardar banco/transferencia
export const openBanco = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { banco, date, autorizado_por } = req.body;
    if (!schema) return res.status(400).json({ error: 'Schema requerido' });
    if (typeof banco !== "number" || !date || !autorizado_por)
      return res.status(400).json({ error: 'Datos incompletos' });

    const entry = await cashService.createBankEntry(schema, { banco, date, autorizado_por });
    res.json(entry);

  } catch (e) {
    res.status(500).json({ error: "Error registrando banco", detail: e.message });
  }
};

// Obtener apertura por fecha
export const getOpening = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { date } = req.query;
    if (!schema || !date) return res.status(400).json({ error: 'Datos incompletos' });

    const opening = await cashService.getOpeningByDate(schema, date);
    res.json(opening);

  } catch (e) {
    res.status(500).json({ error: 'Error servidor', detail: e.message });
  }
};