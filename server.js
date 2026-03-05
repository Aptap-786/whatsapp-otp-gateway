const express = require('express');
const cors = require('cors');
const config = require('./config');
const { initDB, getLatestOTPs, getOTPHistory } = require('./database');
const { createSession, removeSession, getSessionsStatus, getQR } = require('./whatsapp');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── API Key Authentication ────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== config.API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API key' });
  }
  next();
}

// ─── Health check (no auth) ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'WhatsApp OTP Gateway', version: '1.0.0' });
});

// ─── GET /api/latest ──────────────────────────────────────────────────────────
app.get('/api/latest', requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const data = await getLatestOTPs(limit);
    res.json({ success: true, data });
  } catch (err) {
    console.error('/api/latest error:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─── GET /api/history ─────────────────────────────────────────────────────────
app.get('/api/history', requireApiKey, async (req, res) => {
  try {
    const data = await getOTPHistory(50);
    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('/api/history error:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─── GET /api/sessions ────────────────────────────────────────────────────────
app.get('/api/sessions', requireApiKey, (req, res) => {
  const data = getSessionsStatus();
  res.json({ success: true, data, count: data.length });
});

// ─── GET /api/qr/:session ─────────────────────────────────────────────────────
app.get('/api/qr/:session', requireApiKey, (req, res) => {
  const { session } = req.params;
  const qr = getQR(session);
  if (!qr) {
    return res.json({ success: false, error: 'No QR available for this session' });
  }
  res.json({ success: true, qr });
});

// ─── POST /api/add-session ────────────────────────────────────────────────────
app.post('/api/add-session', requireApiKey, (req, res) => {
  const { session_name } = req.body;
  if (!session_name || !/^[a-zA-Z0-9_-]{1,30}$/.test(session_name)) {
    return res.status(400).json({ success: false, error: 'Invalid session_name. Use alphanumeric, dash, or underscore only.' });
  }
  const result = createSession(session_name);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json({ success: true, message: result.message, session_name });
});

// ─── POST /api/remove-session ─────────────────────────────────────────────────
app.post('/api/remove-session', requireApiKey, (req, res) => {
  const { session_name } = req.body;
  if (!session_name) {
    return res.status(400).json({ success: false, error: 'session_name is required' });
  }
  const result = removeSession(session_name);
  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json({ success: true, message: `Session ${session_name} removed` });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDB();
    app.listen(config.PORT, () => {
      console.log(`[SERVER] WhatsApp OTP Gateway running on port ${config.PORT}`);
      console.log(`[SERVER] API Key: ${config.API_KEY}`);
    });
  } catch (err) {
    console.error('[SERVER] Startup failed:', err);
    process.exit(1);
  }
}

start();
