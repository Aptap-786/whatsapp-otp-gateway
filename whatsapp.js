// whatsapp.js - Multi-session WhatsApp manager
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode');
const path    = require('path');
const fs      = require('fs');
const config  = require('./config');
const { saveOTP } = require('./database');

// ── OTP regex — matches 4-8 consecutive digits ─────────────────────────────────
const OTP_REGEX = /\b(\d{4,8})\b/g;

function extractOTP(text) {
  const matches = text.match(OTP_REGEX);
  return matches ? matches[0] : null;
}

// ── In-memory session store ────────────────────────────────────────────────────
// Map<sessionName, { client, status, qrCode, qrDataURL, phone }>
const sessions = new Map();

// ── Ensure session directory exists ───────────────────────────────────────────
function ensureSessionDir() {
  const dir = path.resolve(config.SESSION_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Create or restore one WhatsApp session ─────────────────────────────────────
function createSession(sessionName) {
  if (sessions.has(sessionName)) {
    const existing = sessions.get(sessionName);
    if (['connected', 'initializing', 'qr_pending'].includes(existing.status)) {
      console.log(`[WA] Session "${sessionName}" already active (${existing.status})`);
      return existing;
    }
    // Clean up dead session before recreating
    try { existing.client.destroy(); } catch (_) {}
  }

  console.log(`[WA] Starting session: ${sessionName}`);

  const sessionData = {
    client:    null,
    status:    'initializing',
    qrCode:    null,
    qrDataURL: null,
    phone:     null,
    name:      sessionName,
  };
  sessions.set(sessionName, sessionData);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId:   sessionName,
      dataPath:   path.resolve(config.SESSION_DIR),
    }),
    puppeteer: {
      headless: true,
      args: config.PUPPETEER_ARGS,
      // Use bundled Chromium; on Render set PUPPETEER_EXECUTABLE_PATH env var
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    },
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901740-alpha.html',
    },
  });

  sessionData.client = client;

  // ── QR Code ──────────────────────────────────────────────────────────────────
  client.on('qr', async (qr) => {
    console.log(`[WA] QR for "${sessionName}" — scan with WhatsApp`);
    sessionData.status    = 'qr_pending';
    sessionData.qrCode    = qr;
    sessionData.qrDataURL = await qrcode.toDataURL(qr).catch(() => null);
  });

  // ── Authenticated ─────────────────────────────────────────────────────────────
  client.on('authenticated', () => {
    console.log(`[WA] "${sessionName}" authenticated`);
    sessionData.status = 'authenticated';
    sessionData.qrCode = null;
  });

  // ── Ready ─────────────────────────────────────────────────────────────────────
  client.on('ready', () => {
    const info = client.info;
    sessionData.status = 'connected';
    sessionData.phone  = info?.wid?.user || 'unknown';
    sessionData.qrCode = null;
    console.log(`[WA] "${sessionName}" ready — phone: ${sessionData.phone}`);
  });

  // ── Disconnected — auto-reconnect ─────────────────────────────────────────────
  client.on('disconnected', (reason) => {
    console.warn(`[WA] "${sessionName}" disconnected: ${reason}`);
    sessionData.status = 'disconnected';
    sessionData.qrCode = null;

    // Wait 5 s then try to reconnect
    setTimeout(() => {
      console.log(`[WA] Reconnecting "${sessionName}"...`);
      createSession(sessionName);
    }, 5000);
  });

  // ── Incoming message — extract OTP ───────────────────────────────────────────
  client.on('message', async (msg) => {
    // Only process text messages
    if (!msg.body || msg.fromMe) return;

    const otp = extractOTP(msg.body);
    if (!otp) return;

    const sender = msg.from.replace('@c.us', '');
    console.log(`[OTP] "${sessionName}" from ${sender}: ${otp} | "${msg.body}"`);

    try {
      await saveOTP({
        otp_code:      otp,
        message:       msg.body,
        sender_number: sender,
        session_name:  sessionName,
      });
    } catch (err) {
      console.error('[OTP] DB save error:', err.message);
    }
  });

  // ── Auth failure ──────────────────────────────────────────────────────────────
  client.on('auth_failure', (msg) => {
    console.error(`[WA] Auth failure for "${sessionName}":`, msg);
    sessionData.status = 'auth_failed';
  });

  client.initialize().catch((err) => {
    console.error(`[WA] Init error for "${sessionName}":`, err.message);
    sessionData.status = 'error';
  });

  return sessionData;
}

// ── Remove / destroy a session ─────────────────────────────────────────────────
async function removeSession(sessionName) {
  const sessionData = sessions.get(sessionName);
  if (!sessionData) return false;

  try {
    await sessionData.client.destroy();
  } catch (_) {}

  // Remove session files from disk
  const sessionPath = path.resolve(config.SESSION_DIR, `session-${sessionName}`);
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }

  sessions.delete(sessionName);
  console.log(`[WA] Session "${sessionName}" removed.`);
  return true;
}

// ── Get status of all sessions ─────────────────────────────────────────────────
function getSessionsStatus() {
  const result = [];
  for (const [name, data] of sessions.entries()) {
    result.push({
      name,
      status:    data.status,
      phone:     data.phone,
      hasQR:     !!data.qrCode,
      qrDataURL: data.qrDataURL || null,
    });
  }
  return result;
}

// ── Get single session (for QR retrieval) ────────────────────────────────────
function getSession(sessionName) {
  return sessions.get(sessionName) || null;
}

// ── Auto-restore persisted sessions from disk ─────────────────────────────────
function restorePersistedSessions() {
  const dir = ensureSessionDir();
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('session-')) {
      const sessionName = entry.name.replace('session-', '');
      console.log(`[WA] Restoring persisted session: ${sessionName}`);
      createSession(sessionName);
    }
  }
}

module.exports = {
  createSession,
  removeSession,
  getSessionsStatus,
  getSession,
  restorePersistedSessions,
};
