import pino from 'pino';

const BILLING_LOG_PATTERNS = [
  /sri/i,
  /factur/i,
  /invoice/i,
  /autoriz/i,
  /comprobante/i,
  /emisi/i,
  /clave/i,
  /auth_number/i,
  /subtotal/i,
  /iva/i,
  /impuesto/i,
  /💰|📦|📊|📤|📥|🚀|💾|✅|❌/,
];

const serializeArg = (arg) => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === null || arg === undefined) return '';
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const shouldKeepConsoleLog = (...args) => {
  const text = args.map(serializeArg).join(' ');
  return BILLING_LOG_PATTERNS.some(pattern => pattern.test(text));
};

const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  if (shouldKeepConsoleLog(...args)) {
    originalConsoleLog(...args);
  }
};

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

export default logger;
