// server.js - WhatsApp OTP Gateway — Express API server
'use strict';

const express = require('express');
const cors    = require('cors');
const config  = require('./config');
const db      = require('./database');
const wa      = require('./whatsapp');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.CORS_ORIGIN === '*' ? '*' : config.CORS_ORIGIN.split(','),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── API Key middleware ─────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== config.API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

// ── Health check (no auth) ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'WhatsApp OTP Gateway',
    version: '1.0.0',
    uptime:  Math.floor(process.uptime()) + 's',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/latest  — latest OTP records (default 10)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/latest', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const data  = await db.getLatestOTPs(limit);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[API /latest]', err.message);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/history — last 50 OTP logs
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/history', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const data  = await db.getHistory(limit);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[API /history]', err.message);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions — all WhatsApp session statuses
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sessions', requireApiKey, (req, res) => {
  const data = wa.getSessionsStatus();
  res.json({ success: true, count: data.length, data });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:name/qr — QR data URL for a specific session
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sessions/:name/qr', requireApiKey, (req, res) => {
  const session = wa.getSession(req.params.name);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  if (!session.qrDataURL) {
    return res.json({ success: true, status: session.status, qrDataURL: null,
      message: session.status === 'connected'
        ? 'Already connected — no QR needed'
        : 'QR not yet generated — wait a few seconds and retry' });
  }
  res.json({ success: true, status: session.status, qrDataURL: session.qrDataURL });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/add-session  body: { session_name: "wa1" }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/add-session', requireApiKey, (req, res) => {
  const { session_name } = req.body;

  if (!session_name || !/^[a-zA-Z0-9_-]{1,30}$/.test(session_name)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid session_name. Use only letters, numbers, _ or - (max 30 chars)',
    });
  }

  const active = wa.getSessionsStatus().filter(s =>
    ['connected','initializing','qr_pending','authenticated'].includes(s.status)
  );
  if (active.length >= config.MAX_SESSIONS) {
    return res.status(429).json({
      success: false,
      error: `Maximum sessions (${config.MAX_SESSIONS}) reached`,
    });
  }

  const session = wa.createSession(session_name);

  res.json({
    success: true,
    message: `Session "${session_name}" initializing. Poll /api/sessions/${session_name}/qr for QR code.`,
    session_name,
    status: session.status,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/remove-session  body: { session_name: "wa1" }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/remove-session', requireApiKey, async (req, res) => {
  const { session_name } = req.body;
  if (!session_name) {
    return res.status(400).json({ success: false, error: 'session_name is required' });
  }

  const removed = await wa.removeSession(session_name);
  if (!removed) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  res.json({ success: true, message: `Session "${session_name}" removed.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 fallback
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await db.initDB();
    console.log('[DB] Connected to MySQL');

    wa.restorePersistedSessions();

    app.listen(config.PORT, () => {
      console.log(`[SERVER] WhatsApp OTP Gateway running on port ${config.PORT}`);
      console.log(`[SERVER] Environment: ${config.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[SERVER] Startup failed:', err.message);
    process.exit(1);
  }
}

start();
