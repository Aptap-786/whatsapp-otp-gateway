const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(config.DB);
  }
  return pool;
}

async function initDB() {
  const db = await getPool();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS otp_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      otp_code VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      sender_number VARCHAR(50) NOT NULL,
      session_name VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('[DB] Tables initialized successfully');
}

async function saveOTP({ otp_code, message, sender_number, session_name }) {
  const db = await getPool();
  const [result] = await db.execute(
    `INSERT INTO otp_logs (otp_code, message, sender_number, session_name) VALUES (?, ?, ?, ?)`,
    [otp_code, message, sender_number, session_name]
  );
  return result.insertId;
}

async function getLatestOTPs(limit = 10) {
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT * FROM otp_logs ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

async function getOTPHistory(limit = 50) {
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT * FROM otp_logs ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

async function findUser(username) {
  const db = await getPool();
  const [rows] = await db.execute(
    `SELECT * FROM users WHERE username = ? LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

module.exports = { initDB, saveOTP, getLatestOTPs, getOTPHistory, findUser };
