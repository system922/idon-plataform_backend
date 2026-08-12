// utils/orderNumberGenerator.js
import { query } from '../config/database.js';

/**
 * Genera un número de recepción único
 * Formato: RC-YYYYMMDD-XXXX
 * Ejemplo: RC-20260810-0001
 */
export async function generateReceiptNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT receipt_number 
    FROM "${schema}".purchase_receipts 
    WHERE receipt_number LIKE 'RC-' || $1 || '-%'
    ORDER BY receipt_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].receipt_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `RC-${dateStr}-${seqStr}`;
}

/**
 * Genera un número de orden de compra único
 * Formato: OC-YYYYMMDD-XXXX
 * Ejemplo: OC-20260810-0001
 */
export async function generateOrderNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT order_number 
    FROM "${schema}".purchase_orders 
    WHERE order_number LIKE 'OC-' || $1 || '-%'
    ORDER BY order_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].order_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `OC-${dateStr}-${seqStr}`;
}

/**
 * Genera un número de factura único
 * Formato: FAC-YYYYMMDD-XXXX
 * Ejemplo: FAC-20260810-0001
 */
export async function generateInvoiceNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT invoice_number 
    FROM "${schema}".invoices 
    WHERE invoice_number LIKE 'FAC-' || $1 || '-%'
    ORDER BY invoice_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].invoice_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `FAC-${dateStr}-${seqStr}`;
}

/**
 * Genera un número de nota de crédito único
 * Formato: NC-YYYYMMDD-XXXX
 * Ejemplo: NC-20260810-0001
 */
export async function generateCreditNoteNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT credit_note_number 
    FROM "${schema}".credit_notes 
    WHERE credit_note_number LIKE 'NC-' || $1 || '-%'
    ORDER BY credit_note_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].credit_note_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `NC-${dateStr}-${seqStr}`;
}

/**
 * Genera un número de nota de débito único
 * Formato: ND-YYYYMMDD-XXXX
 * Ejemplo: ND-20260810-0001
 */
export async function generateDebitNoteNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT debit_note_number 
    FROM "${schema}".debit_notes 
    WHERE debit_note_number LIKE 'ND-' || $1 || '-%'
    ORDER BY debit_note_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].debit_note_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `ND-${dateStr}-${seqStr}`;
}

/**
 * Genera un número de guía de remisión único
 * Formato: GR-YYYYMMDD-XXXX
 * Ejemplo: GR-20260810-0001
 */
export async function generateGuideNumber(schema) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT guide_number 
    FROM "${schema}".guides 
    WHERE guide_number LIKE 'GR-' || $1 || '-%'
    ORDER BY guide_number DESC 
    LIMIT 1
  `, [dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0].guide_number;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(4, '0');
  return `GR-${dateStr}-${seqStr}`;
}

/**
 * Genera un número genérico para cualquier entidad
 * @param {string} schema - El esquema de la base de datos
 * @param {string} table - La tabla donde buscar
 * @param {string} column - La columna que contiene el número
 * @param {string} prefix - El prefijo (ej: INV-, PRD-, etc.)
 * @param {number} digits - Número de dígitos para el secuencial (default: 4)
 */
export async function generateNumber(schema, table, column, prefix, digits = 4) {
  const today = new Date();
  const dateStr = today.getFullYear() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');
  
  const result = await query(`
    SELECT ${column} 
    FROM "${schema}".${table} 
    WHERE ${column} LIKE $1 || $2 || '-%'
    ORDER BY ${column} DESC 
    LIMIT 1
  `, [prefix, dateStr]);
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastNumber = result.rows[0][column];
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }
  }
  
  const seqStr = String(nextNumber).padStart(digits, '0');
  return `${prefix}${dateStr}-${seqStr}`;
}

// Exportar todo como objeto
export default {
  generateReceiptNumber,
  generateOrderNumber,
  generateInvoiceNumber,
  generateCreditNoteNumber,
  generateDebitNoteNumber,
  generateGuideNumber,
  generateNumber
};