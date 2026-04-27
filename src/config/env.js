import dotenv from 'dotenv';

dotenv.config();

export default {
  environment: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 4000,
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/idon_control',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRATION || '24h',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
