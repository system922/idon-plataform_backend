// utils/orderNumberGenerator.js
import { query } from '../config/database.js';

/**
 * Genera un número de orden único para compras
 * Formato: OC-YYYYMMDD-XXXX
 * Ejemplo: OC-20260810-0001, OC-20260810-0002, etc.
 * 
 * @param {string} schema - El esquema de la base de datos (ej: tenant_comidas_rapidas)
 * @returns {Promise<string>} - Número de orden generado
 */
export async function generateOrderNumber(schema) {
  // Obtener la fecha actual en formato YYYYMMDD
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  // Buscar el último número de orden del día actual
  const result = await query(`
    SELECT order_number 
    FROM "${schema}".purchase_orders 
    WHERE order_number LIKE 'OC-' || $1 || '-%'
    ORDER BY order_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastOrderNumber = result.rows[0].order_number;
    // Extraer el número secuencial (ej: OC-20260810-0005 → 0005 → 5)
    const parts = lastOrderNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  // Formatear el número con 4 dígitos (0001, 0002, etc.)
  const seqStr = String(nextNumber).padStart(4, '0');
  
  return `OC-${dateStr}-${seqStr}`;
}