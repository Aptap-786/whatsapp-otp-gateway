// database.js - MySQL connection pool + auto table creation
const mysql  = require('mysql2/promise');
const config = require('./config');

// ── Create pool ────────────────────────────────────────────────────────────────
const pool = mysql.createPool(config.DB);

// ── Initialise tables ──────────────────────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    // users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // otp_logs table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS otp_logs (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        otp_code      VARCHAR(20)  NOT NULL,
        message       TEXT         NOT NULL,
        sender_number VARCHAR(50)  NOT NULL,
        session_name  VARCHAR(50)  NOT NULL,
        created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (created_at),
        INDEX idx_otp     (otp_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Insert default admin if no users exist
    const [rows] = await conn.execute('SELECT COUNT(*) AS cnt FROM users');
    if (rows[0].cnt === 0) {
      // Default: admin / admin123  — change after first login
      const bcrypt = require('crypto');
      const hash = require('crypto')
        .createHash('sha256')
        .update('admin123')
        .digest('hex');
      // We store a PHP-compatible bcrypt-style hash via a simple SHA-256 placeholder.
      // The real password_hash is handled in PHP; here we just insert a marker.
      // For Node-only login we use a simple token — auth is handled by PHP frontend.
      await conn.execute(
        'INSERT IGNORE INTO users (username, password_hash) VALUES (?, ?)',
        ['admin', '$2y$10$placeholder_set_via_php_login']
      );
    }

    console.log('[DB] Tables ready.');
  } finally {
    conn.release();
  }
}

// ── Save OTP log ───────────────────────────────────────────────────────────────
async function saveOTP({ otp_code, message, sender_number, session_name }) {
  const [result] = await pool.execute(
    `INSERT INTO otp_logs (otp_code, message, sender_number, session_name)
     VALUES (?, ?, ?, ?)`,
    [otp_code, message, sender_number, session_name]
  );
  return result.insertId;
}

// ── Latest OTP records ─────────────────────────────────────────────────────────
async function getLatestOTPs(limit = 10) {
  const [rows] = await pool.execute(
    `SELECT * FROM otp_logs ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

// ── History (last 50) ──────────────────────────────────────────────────────────
async function getHistory(limit = 50) {
  const [rows] = await pool.execute(
    `SELECT * FROM otp_logs ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = { pool, initDB, saveOTP, getLatestOTPs, getHistory };
