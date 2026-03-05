require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  API_KEY: process.env.API_KEY || 'Aptap786920',

  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cztldhwx_whatsapp-otp-gateway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  },

  WHATSAPP: {
    maxSessions: 10,
    sessionDir: './sessions',
    reconnectDelay: 5000,
  },

  OTP_REGEX: /\b\d{4,8}\b/g,
};
