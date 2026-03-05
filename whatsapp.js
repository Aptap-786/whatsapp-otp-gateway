const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const { saveOTP } = require('./database');

// In-memory session registry
const sessions = {};
// QR codes waiting to be scanned
const pendingQRs = {};

function extractOTP(text) {
  const matches = text.match(config.OTP_REGEX);
  if (!matches) return null;
  // Return the first match that looks like a real OTP (4-8 digits)
  for (const m of matches) {
    if (m.length >= 4 && m.length <= 8) return m;
  }
  return null;
}

function createSession(sessionName) {
  if (sessions[sessionName]) {
    return { success: false, error: 'Session already exists' };
  }

  console.log(`[WA] Creating session: ${sessionName}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionName,
      dataPath: config.WHATSAPP.sessionDir,
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    },
  });

  sessions[sessionName] = {
    client,
    name: sessionName,
    status: 'initializing',
    phone: null,
    qr: null,
  };

  // QR event
  client.on('qr', (qr) => {
    console.log(`[WA:${sessionName}] QR generated`);
    qrcode.generate(qr, { small: true });
    sessions[sessionName].qr = qr;
    sessions[sessionName].status = 'qr_pending';
    pendingQRs[sessionName] = qr;
  });

  // Ready event
  client.on('ready', () => {
    const info = client.info;
    sessions[sessionName].status = 'connected';
    sessions[sessionName].phone = info?.wid?.user || 'unknown';
    sessions[sessionName].qr = null;
    delete pendingQRs[sessionName];
    console.log(`[WA:${sessionName}] Connected — ${sessions[sessionName].phone}`);
  });

  // Auth failure
  client.on('auth_failure', (msg) => {
    console.error(`[WA:${sessionName}] Auth failed:`, msg);
    sessions[sessionName].status = 'auth_failed';
  });

  // Disconnected — auto reconnect
  client.on('disconnected', (reason) => {
    console.warn(`[WA:${sessionName}] Disconnected: ${reason}`);
    sessions[sessionName].status = 'disconnected';
    setTimeout(() => {
      console.log(`[WA:${sessionName}] Reconnecting...`);
      client.initialize().catch(console.error);
    }, config.WHATSAPP.reconnectDelay);
  });

  // Incoming message — OTP detection
  client.on('message', async (msg) => {
    try {
      const body = msg.body || '';
      const otp = extractOTP(body);
      if (!otp) return;

      const sender = msg.from || 'unknown';
      console.log(`[WA:${sessionName}] OTP detected: ${otp} from ${sender}`);

      await saveOTP({
        otp_code: otp,
        message: body,
        sender_number: sender,
        session_name: sessionName,
      });

      console.log(`[DB] OTP saved: ${otp}`);
    } catch (err) {
      console.error(`[WA:${sessionName}] Message handler error:`, err);
    }
  });

  client.initialize().catch((err) => {
    console.error(`[WA:${sessionName}] Init error:`, err);
    sessions[sessionName].status = 'error';
  });

  return { success: true, message: 'Session initializing, scan QR shortly' };
}

function removeSession(sessionName) {
  const session = sessions[sessionName];
  if (!session) return { success: false, error: 'Session not found' };

  session.client.destroy().catch(() => {});
  delete sessions[sessionName];
  delete pendingQRs[sessionName];
  console.log(`[WA] Session removed: ${sessionName}`);
  return { success: true };
}

function getSessionsStatus() {
  return Object.values(sessions).map((s) => ({
    name: s.name,
    status: s.status,
    phone: s.phone,
    hasQR: !!s.qr,
  }));
}

function getQR(sessionName) {
  return pendingQRs[sessionName] || null;
}

module.exports = { createSession, removeSession, getSessionsStatus, getQR };
