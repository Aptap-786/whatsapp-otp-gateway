// config.js - Central configuration for WhatsApp OTP Gateway
require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // API Security
  API_KEY: process.env.API_KEY || 'change-this-api-key-in-production',

  // MySQL Database
  DB: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'otp_gateway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  },

  // WhatsApp Sessions
  MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS) || 10,
  SESSION_DIR: process.env.SESSION_DIR || './sessions',

  // CORS — comma-separated allowed origins, or * for all
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // Puppeteer / Chrome args for headless server (Render.com compatible)
  PUPPETEER_ARGS: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--single-process',
  ],
};
