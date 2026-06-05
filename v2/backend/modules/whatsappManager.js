/**
 * whatsappManager.js — Motor WhatsApp de alta disponibilidad
 *
 * Garantías:
 *  - Nunca mata el proceso Node por errores de Puppeteer/WA
 *  - Heartbeat ligero (getState) cada 45s detecta páginas colgadas
 *  - Circuit breaker: máx 5 reinicios/10min, luego pausa de 10min
 *  - Arranque escalonado para no saturar recursos de Chrome
 *  - Flag `restarting` previene reinicios dobles (browser.disconnected + client.disconnected)
 *  - Contador se resetea tras 5min de conexión estable
 */

'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs     = require('fs');
const path   = require('path');

// ── Estado global de sesiones ─────────────────────────────────
// { client, status, timers, restarting }
const sessions = new Map();
const DEFAULT_SESSION_ID = 'session-1';

// ── Circuit breaker ───────────────────────────────────────────
const restartHistory = new Map(); // sessionId → number[]

const CB_MAX_RESTARTS = 5;
const CB_WINDOW_MS    = 10 * 60 * 1000;
const CB_COOLDOWN_MS  = 10 * 60 * 1000;
const STABLE_RESET_MS = 5  * 60 * 1000;
const WATCHDOG_MS     = 120 * 1000; // 2min sin QR/conexión → reinicio
const QR_GRACE_MS     = 5  * 60 * 1000; // extender watchdog si hay QR activo
const HEARTBEAT_MS    = 45 * 1000; // ping cada 45s
const DESTROY_TIMEOUT = 10 * 1000;

// ── Puppeteer args optimizados ────────────────────────────────
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-software-rasterizer',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
  '--js-flags=--max-old-space-size=512',
  '--memory-pressure-off',
];

// ── Helpers de teléfono ───────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (!d || d.length < 7) return null;
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  return d;
}

function formatPhoneForWA(phone) {
  const n = normalizePhone(phone);
  return n ? `${n}@c.us` : null;
}

async function getValidChatId(client, phone) {
  const rawChatId = formatPhoneForWA(phone);
  if (!rawChatId) return { chatId: null, confirmed: false };
  try {
    const contactId = await client.getNumberId(rawChatId);
    if (contactId) return { chatId: rawChatId, confirmed: true };
    return { chatId: rawChatId, confirmed: false };
  } catch (e) {
    if (e.message?.includes('No LID')) throw new Error(`Fatal WA MD Error: ${e.message}`);
    console.warn(`[getValidChatId] ${rawChatId}: ${e.message}`);
    return { chatId: rawChatId, confirmed: null };
  }
}

async function sendWithRetry(client, chatId, payload, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      if (typeof payload === 'string') return await client.sendMessage(chatId, payload);
      return await client.sendMessage(chatId, payload.media, payload.options || {});
    } catch (e) {
      if (e.message?.includes('No LID for user')) throw new Error(`Fatal WA MD Error: ${e.message}`);
      if (i === attempts) throw e;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

// ── Circuit breaker ───────────────────────────────────────────
function canRestart(sessionId) {
  const now     = Date.now();
  const history = (restartHistory.get(sessionId) || []).filter(t => now - t < CB_WINDOW_MS);
  restartHistory.set(sessionId, history);
  return history.length < CB_MAX_RESTARTS;
}

function recordRestart(sessionId) {
  const h = restartHistory.get(sessionId) || [];
  h.push(Date.now());
  restartHistory.set(sessionId, h);
}

function resetRestartHistory(sessionId) {
  restartHistory.set(sessionId, []);
}

// ── Timers ────────────────────────────────────────────────────
function clearSessionTimers(sessionId) {
  const s = sessions.get(sessionId);
  if (!s?.timers) return;
  const { watchdog, heartbeat, stableReset, restartDelay } = s.timers;
  if (watchdog)     clearTimeout(watchdog);
  if (heartbeat)    clearInterval(heartbeat);
  if (stableReset)  clearTimeout(stableReset);
  if (restartDelay) clearTimeout(restartDelay);
  s.timers = {};
}

// ── Destroy sin bloquear ──────────────────────────────────────
async function safeDestroy(client) {
  if (!client) return;
  try {
    await Promise.race([
      client.destroy(),
      new Promise(r => setTimeout(r, DESTROY_TIMEOUT)),
    ]);
  } catch { /* ignorar */ }
}

// ── Emit ──────────────────────────────────────────────────────
function emitStatus(sessionId, status) {
  global.io?.emit(`whatsapp:status:${sessionId}`, status);
}

// ── Restart con circuit breaker ───────────────────────────────
// Solo una llamada concurrente por sesión gracias al flag `restarting`
function _scheduleRestart(sessionId) {
  // Crear entrada mínima si no existe (para almacenar timers durante cooldown)
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { client: null, status: { connected: false, state: 'RESTARTING', qr: null }, timers: {}, restarting: true });
  }

  const s = sessions.get(sessionId);

  if (!canRestart(sessionId)) {
    console.warn(`[WA:${sessionId}] ⛔ Circuit breaker — pausa ${CB_COOLDOWN_MS / 60000}min`);
    s.status = { connected: false, state: 'CIRCUIT_OPEN', qr: null };
    global.db?.prepare("UPDATE sessions SET status = 'CIRCUIT_OPEN' WHERE id = ?").run(sessionId);
    emitStatus(sessionId, s.status);

    s.timers.restartDelay = setTimeout(() => {
      console.log(`[WA:${sessionId}] 🔄 Cooldown terminado — reintentando`);
      resetRestartHistory(sessionId);
      sessions.delete(sessionId);
      createClient(sessionId);
    }, CB_COOLDOWN_MS);
    return;
  }

  recordRestart(sessionId);
  const count   = (restartHistory.get(sessionId) || []).length;
  const backoff = Math.min(count * 8000, 30000);
  console.log(`[WA:${sessionId}] ♻️ Reinicio #${count} en ${backoff / 1000}s`);

  s.status = { connected: false, state: 'RESTARTING', qr: null };
  emitStatus(sessionId, s.status);

  s.timers.restartDelay = setTimeout(() => {
    sessions.delete(sessionId);
    createClient(sessionId);
  }, backoff);
}

// ── Abortar si el motivo es trivial ──────────────────────────
const IGNORABLE_REASONS = ['LOGOUT'];

// ── Lógica unificada de desconexión ──────────────────────────
// Llamada tanto por client.disconnected como por browser.disconnected.
// El flag restarting evita que se ejecute dos veces.
async function _handleDisconnect(sessionId, reason, clientRef) {
  const s = sessions.get(sessionId);
  if (!s || s.restarting) return; // ya en proceso de reinicio
  s.restarting = true;

  console.log(`[WA:${sessionId}] ❌ Desconexión: ${reason}`);
  clearSessionTimers(sessionId);
  s.status.connected = false;
  s.status.state     = 'DISCONNECTED';
  s.status.qr        = null;

  global.db?.prepare("UPDATE sessions SET status = 'DISCONNECTED', lastUsed = CURRENT_TIMESTAMP WHERE id = ?")
            .run(sessionId);
  emitStatus(sessionId, s.status);
  sessions.delete(sessionId);

  if (clientRef) await safeDestroy(clientRef);

  if (!IGNORABLE_REASONS.includes(reason)) {
    _scheduleRestart(sessionId);
  }
}

// ── Heartbeat con getState() — no toca la página directamente ─
function _startHeartbeat(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;

  let consecutiveFails = 0;

  s.timers.heartbeat = setInterval(async () => {
    const sess = sessions.get(sessionId);
    if (!sess?.status?.connected || sess.restarting) return;

    try {
      // getState() es mucho más ligero que page.evaluate() y no lanza "detached Frame"
      const state = await Promise.race([
        sess.client.getState(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
      ]);

      if (state === 'CONNECTED') {
        consecutiveFails = 0;
        return;
      }
      // Estado no conectado pero cliente sigue vivo → reportar pero no reiniciar aún
      console.warn(`[WA:${sessionId}] ❤️ getState=${state}`);
      consecutiveFails++;
    } catch (e) {
      consecutiveFails++;
      console.warn(`[WA:${sessionId}] ❤️ Heartbeat falla #${consecutiveFails}: ${e.message}`);
    }

    if (consecutiveFails >= 3) {
      console.error(`[WA:${sessionId}] 💀 Heartbeat: ${consecutiveFails} fallos — forzando reinicio`);
      const curr = sessions.get(sessionId);
      if (!curr || curr.restarting) return;
      await _handleDisconnect(sessionId, 'HEARTBEAT_FAIL', curr.client);
    }
  }, HEARTBEAT_MS);
}

// ── Crear cliente ─────────────────────────────────────────────
function createClient(sessionId = DEFAULT_SESSION_ID) {
  if (sessions.has(sessionId)) {
    const s = sessions.get(sessionId);
    if (s.status) emitStatus(sessionId, s.status);
    return s.client;
  }

  const db     = global.db;
  const status = { connected: false, qr: null, phone: null, name: null, state: 'INITIALIZING' };
  const timers = {};

  // --- Limpieza preventiva de SingletonLock ---
  try {
    const fs = require('fs');
    const dataPath = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.wwebjs_auth') : path.join(__dirname, '..', '.wwebjs_auth');
    const sessionDir = path.join(dataPath, `session-${sessionId}`);
    
    // Lista de rutas donde Chromium deja archivos de bloqueo
    const lockPaths = [
      path.join(sessionDir, 'SingletonLock'),
      path.join(sessionDir, 'SingletonCookie'),
      path.join(sessionDir, 'SingletonSocket'),
      path.join(sessionDir, 'Default', 'SingletonLock'),
      path.join(sessionDir, 'Default', 'SingletonCookie'),
      path.join(sessionDir, 'Default', 'SingletonSocket')
    ];
    
    lockPaths.forEach(lockPath => {
      if (fs.existsSync(lockPath)) {
        try { fs.unlinkSync(lockPath); console.log(`[WA:${sessionId}] 🧹 Lock file eliminado preventivamente: ${path.basename(lockPath)}`); } catch(e){}
      }
    });
  } catch(e) {
    console.error(`[WA:${sessionId}] Error limpiando lock files:`, e.message);
  }
  // ------------------------------------------

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath:  process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.wwebjs_auth') : path.join(__dirname, '..', '.wwebjs_auth'),
    }),
    webVersionCache: {
      type:       'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
      headless:       true,
      executablePath: (() => {
        const fs = require('fs');
        if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
        if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
        if (fs.existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
        if (fs.existsSync('/usr/bin/google-chrome-stable')) return '/usr/bin/google-chrome-stable';
        return undefined;
      })(),
      args:           PUPPETEER_ARGS,
      timeout:        60000,
    },
    authTimeoutMs:     180000,
    restartOnAuthFail: false,
  });

  sessions.set(sessionId, { client, status, timers, restarting: false });

  // Watchdog: si en 2min no hay QR ni conexión → reiniciar
  timers.watchdog = setTimeout(async () => {
    const s = sessions.get(sessionId);
    if (!s || s.restarting) return;
    if (s.status.state === 'INITIALIZING') {
      console.error(`[WA:${sessionId}] 🚨 Watchdog — sin respuesta en ${WATCHDOG_MS / 1000}s`);
      await _handleDisconnect(sessionId, 'WATCHDOG', client);
    } else if (s.status.state === 'QR_READY') {
      // Usuario probablemente escaneando — dar 5min más de gracia
      console.log(`[WA:${sessionId}] ⏳ QR visible — extendiendo watchdog ${QR_GRACE_MS / 60000}min`);
      timers.watchdog = setTimeout(async () => {
        const s2 = sessions.get(sessionId);
        if (s2 && !s2.restarting && s2.status.state === 'QR_READY') {
          console.warn(`[WA:${sessionId}] ⏰ QR expiró sin escanear — reiniciando`);
          await _handleDisconnect(sessionId, 'QR_TIMEOUT', client);
        }
      }, QR_GRACE_MS);
    }
  }, WATCHDOG_MS);

  // ── Eventos ───────────────────────────────────────────────────
  client.on('qr', async (qr) => {
    clearTimeout(timers.watchdog);
    try {
      status.qr    = await qrcode.toDataURL(qr);
      status.state = 'QR_READY';
      console.log(`[WA:${sessionId}] 📱 QR listo`);
      emitStatus(sessionId, status);
      // Iniciar watchdog extendido para QR
      timers.watchdog = setTimeout(async () => {
        const s = sessions.get(sessionId);
        if (s && !s.restarting && s.status.state === 'QR_READY') {
          console.warn(`[WA:${sessionId}] ⏰ QR expiró — reiniciando`);
          await _handleDisconnect(sessionId, 'QR_TIMEOUT', client);
        }
      }, QR_GRACE_MS);
    } catch (err) {
      console.error('[WA] Error generando QR:', err.message);
    }
  });

  client.on('authenticated', () => {
    clearTimeout(timers.watchdog);
    status.state = 'AUTHENTICATED';
    db?.prepare('UPDATE sessions SET status = ?, lastUsed = CURRENT_TIMESTAMP WHERE id = ?')
       .run('AUTHENTICATED', sessionId);
    console.log(`[WA:${sessionId}] 🔐 Autenticado`);
  });

  client.on('ready', async () => {
    clearTimeout(timers.watchdog);
    const s = sessions.get(sessionId);
    if (!s) return;
    s.restarting = false;

    status.connected = true;
    status.qr        = null;
    status.state     = 'CONNECTED';

    try {
      const info   = client.info;
      status.phone = info.wid.user;
      status.name  = info.pushname || 'Cuenta';
      console.log(`[WA:${sessionId}] ✅ Conectado: ${status.name} (${status.phone})`);
      db?.prepare('UPDATE sessions SET status = ?, phone = ?, lastUsed = CURRENT_TIMESTAMP WHERE id = ?')
         .run('CONNECTED', status.phone, sessionId);
    } catch (e) {
      console.error(`[WA:${sessionId}] Error leyendo info:`, e.message);
    }

    emitStatus(sessionId, status);

    // Enganchar browser.disconnected — usa _handleDisconnect que tiene el guard restarting
    try {
      const page = client.pupPage;
      if (page) {
        page.on('error',     (e) => console.warn(`[WA:${sessionId}] page.error: ${e?.message}`));
        page.on('pageerror', (e) => console.warn(`[WA:${sessionId}] pageerror: ${e?.message}`));
        page.browser().on('disconnected', async () => {
          await _handleDisconnect(sessionId, 'BROWSER_CRASH', null);
        });
      }
    } catch { /* pupPage no disponible — no crítico */ }

    _startHeartbeat(sessionId);

    // Resetear historial tras 5min estable
    timers.stableReset = setTimeout(() => {
      resetRestartHistory(sessionId);
      console.log(`[WA:${sessionId}] 💚 Estable 5min — contador reseteado`);
    }, STABLE_RESET_MS);
  });

  client.on('auth_failure', async (msg) => {
    console.error(`[WA:${sessionId}] ⚠️ Auth failure: ${msg}`);
    const s = sessions.get(sessionId);
    if (!s || s.restarting) return;
    s.restarting = true;

    clearSessionTimers(sessionId);
    status.state = 'AUTH_FAILED';
    db?.prepare("UPDATE sessions SET status = 'ERROR' WHERE id = ?").run(sessionId);
    emitStatus(sessionId, status);

    // Borrar credenciales corruptas y reiniciar
    sessions.delete(sessionId);
    const authPath = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.wwebjs_auth', `session-${sessionId}`) : path.join(__dirname, '..', '.wwebjs_auth', `session-${sessionId}`);
    try { if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
    _scheduleRestart(sessionId);
  });

  // client.on('disconnected') es la fuente primaria de desconexión
  client.on('disconnected', async (reason) => {
    // NO llamar safeDestroy aquí — whatsapp-web.js ya limpia internamente
    await _handleDisconnect(sessionId, reason, null);
  });

  client.on('error', (err) => {
    console.warn(`[WA:${sessionId}] client.error: ${err?.message || err}`);
  });

  // Inbox
  client.on('message', async (msg) => {
    if (msg.isGroupMsg || msg.type !== 'chat') return;
    const phone = msg.from.replace('@c.us', '');
    try {
      const p = db?.prepare('SELECT id, name FROM prospects WHERE phone LIKE ? AND sessionId = ?')
                    .get(`%${phone.slice(-9)}%`, sessionId);
      db?.prepare('INSERT INTO replies (sessionId, fromPhone, prospectId, prospectName, message, timestamp) VALUES (?,?,?,?,?,?)')
         .run(sessionId, phone, p?.id || null, p?.name || null, msg.body, new Date().toISOString());
      if (p?.id) {
        db?.prepare('UPDATE campaigns SET repliesCount = repliesCount + 1 WHERE id = (SELECT lastCampaignId FROM prospects WHERE id = ? AND sessionId = ?)')
           .run(p.id, sessionId);
      }
      global.io?.emit(`wa:reply:${sessionId}`, { phone, prospectName: p?.name, prospectId: p?.id, message: msg.body });
    } catch (e) {
      console.error('[WA] Error guardando reply:', e.message);
    }
  });

  // Inicializar
  client.initialize().catch(async (err) => {
    const msg = err?.message || '';
    console.error(`[WA:${sessionId}] Error inicializando: ${msg}`);
    clearSessionTimers(sessionId);
    const s = sessions.get(sessionId);
    if (s && !s.restarting) {
      s.restarting = true;
      sessions.delete(sessionId);
      _scheduleRestart(sessionId);
    }
  });

  return client;
}

// ── API pública ───────────────────────────────────────────────
module.exports = {
  sessions,
  createClient,
  normalizePhone,
  getValidChatId,

  // Cargar TODAS las sesiones activas al arrancar
  initializeAllSessions() {
    const list = global.db?.prepare(
      "SELECT id FROM sessions WHERE isActive = 1 ORDER BY lastUsed DESC"
    ).all() || [];
    console.log(`📡 [WA] Iniciando ${list.length} sesión(es)...`);
    list.forEach((s, idx) => {
      setTimeout(() => createClient(s.id), idx * 15000);
    });
  },

  async resetSession(sessionId = DEFAULT_SESSION_ID) {
    console.log(`[WA:${sessionId}] 🔄 Hard Reset`);
    const s = sessions.get(sessionId);
    if (s) s.restarting = true;
    clearSessionTimers(sessionId);
    resetRestartHistory(sessionId);
    sessions.delete(sessionId);
    if (s?.client) await safeDestroy(s.client);
    const authPath = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, '.wwebjs_auth', `session-${sessionId}`) : path.join(__dirname, '..', '.wwebjs_auth', `session-${sessionId}`);
    try { if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
    setTimeout(() => createClient(sessionId), 2000);
    return true;
  },

  async hibernateSession(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.restarting = true;
    clearSessionTimers(sessionId);
    await safeDestroy(s.client);
    sessions.delete(sessionId);
    global.db?.prepare("UPDATE sessions SET status = 'HIBERNATED' WHERE id = ?").run(sessionId);
    console.log(`[WA:${sessionId}] 💤 Hibernado`);
  },

  async destroySession(sessionId) {
    console.log(`[WA:${sessionId}] 🗑️ Destruyendo`);
    const s = sessions.get(sessionId);
    if (s) s.restarting = true;
    clearSessionTimers(sessionId);
    resetRestartHistory(sessionId);
    sessions.delete(sessionId);
    if (s?.client) await safeDestroy(s.client);
  },

  getStatus(sessionId = DEFAULT_SESSION_ID) {
    return sessions.get(sessionId)?.status || { connected: false, state: 'NOT_LOADED', qr: null };
  },

  async sendText(phone, message, sessionId = DEFAULT_SESSION_ID) {
    const s = sessions.get(sessionId);
    if (!s?.status?.connected) throw new Error('WhatsApp no está conectado');
    const { chatId } = await getValidChatId(s.client, phone);
    if (!chatId) throw new Error(`Número inválido: ${phone}`);
    return sendWithRetry(s.client, chatId, message);
  },

  async checkNumber(phone, sessionId = DEFAULT_SESSION_ID) {
    const s = sessions.get(sessionId);
    if (!s?.status?.connected) return null;
    const { confirmed } = await getValidChatId(s.client, phone);
    return confirmed;
  },
};
