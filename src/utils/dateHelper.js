/**
 * dateHelper.js
 * Helpers de fecha/hora para la zona horaria de Ecuador (America/Guayaquil, UTC-5).
 * Úsalos siempre que necesites "hoy" o "ahora" en el servidor.
 */

const TZ = 'America/Guayaquil';

/**
 * Retorna la fecha de hoy en Ecuador como string YYYY-MM-DD.
 * Reemplaza: new Date().toISOString().split('T')[0]  ← eso es UTC, no Ecuador.
 */
export function ecuadorToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // 'en-CA' → YYYY-MM-DD
}

/**
 * Retorna la fecha y hora actual de Ecuador como string ISO local
 * (sin 'Z' al final, ya en hora Ecuador).
 */
export function ecuadorNowISO() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: TZ })).toISOString().replace('Z', '');
}

/**
 * Convierte cualquier Date o string de timestamp a fecha Ecuador YYYY-MM-DD.
 */
export function toEcuadorDate(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : new Date(dateOrStr);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Formatea una fecha/timestamp para mostrar al usuario en Ecuador.
 * Retorna: "23/04/2026 10:30:00"
 */
export function formatEcuadorDateTime(dateOrStr) {
  if (!dateOrStr) return '—';
  const d = dateOrStr instanceof Date ? dateOrStr : new Date(dateOrStr);
  return d.toLocaleString('es-EC', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}
