const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

// Mapa de clientes activos: sessionId -> { client, status }
const sessions = new Map();
const DEFAULT_SESSION_ID = 'session-1';
let ioRef = null;

function init(io) {
  ioRef = io;
  // Initialize the default session to maintain backward compatibility
  createClient(DEFAULT_SESSION_ID);
}

function createClient(sessionId = DEFAULT_SESSION_ID) {
  try {
    const sessionStatus = { connected: false, phone: null, name: null, qr: null, state: 'DISCONNECTED', sessionId };
    sessions.set(sessionId, { client: null, status: sessionStatus });
    
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionId }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          // 🚀 Extreme Performance Opts
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--disable-crash-reporter',
          '--disable-default-apps',
          '--mute-audio',
          '--disable-web-security'
        ]
      },
      // Evitar que se quede trabado validando la versión de WA Web
      webVersionCache: { type: 'none' },
      authTimeoutMs: 60000,
      qrMaxRetries: 5
    });

    sessions.set(sessionId, { client, status: sessionStatus });

    client.on('qr', async (qr) => {
      console.log(`QR generado para ${sessionId}`);
      sessionStatus.state = 'QR_READY';
      sessionStatus.qr = await qrcode.toDataURL(qr);
      if (ioRef) ioRef.emit(`whatsapp:qr:${sessionId}`, { qr: sessionStatus.qr });
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:qr', { qr: sessionStatus.qr });
    });

    client.on('ready', async () => {
      console.log(`WhatsApp conectado! [${sessionId}]`);
      const info = client.info;
      Object.assign(sessionStatus, {
        connected: true, phone: info.wid.user, name: info.pushname, profilePic: null, qr: null, state: 'CONNECTED'
      });
      if (ioRef) ioRef.emit(`whatsapp:status:${sessionId}`, sessionStatus);
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:status', sessionStatus);

      // Emitir chats recientes al frontend
      try {
        const chats = await client.getChats();
        const recentChats = await Promise.all(
          chats.slice(0, 30).map(async (chat) => {
            let avatarUrl = null;
            try { avatarUrl = await client.getProfilePicUrl(chat.id._serialized); } catch {}
            return {
              id: chat.id._serialized,
              name: chat.name,
              isGroup: chat.isGroup,
              lastMessage: chat.lastMessage ? {
                body: chat.lastMessage.body?.slice(0, 80) || '',
                fromMe: chat.lastMessage.fromMe,
                timestamp: chat.lastMessage.timestamp
              } : null,
              unreadCount: chat.unreadCount,
              avatarUrl,
              timestamp: chat.timestamp
            };
          })
        );
        if (ioRef) ioRef.emit(`whatsapp:chats:${sessionId}`, { sessionId, chats: recentChats });
      } catch (e) {
        console.warn(`[WA:${sessionId}] No se pudieron obtener chats:`, e.message);
      }
    });

    client.on('authenticated', () => {
      console.log(`Autenticado [${sessionId}]`);
      sessionStatus.state = 'AUTHENTICATED';
      if (ioRef) ioRef.emit(`whatsapp:status:${sessionId}`, sessionStatus);
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:status', sessionStatus);
    });

    client.on('auth_failure', (msg) => {
      console.error(`Auth fallo [${sessionId}]:`, msg);
      Object.assign(sessionStatus, { connected: false, phone: null, name: null, qr: null, state: 'AUTH_FAILED' });
      if (ioRef) ioRef.emit(`whatsapp:status:${sessionId}`, sessionStatus);
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:status', sessionStatus);
    });

    client.on('disconnected', async (reason) => {
      console.log(`Desconectado [${sessionId}]:`, reason);
      Object.assign(sessionStatus, { connected: false, phone: null, name: null, qr: null, state: 'DISCONNECTED' });
      if (ioRef) ioRef.emit(`whatsapp:status:${sessionId}`, sessionStatus);
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:status', sessionStatus);
      
      // Limpieza robusta de memoria (Evita múltiples instancias zombi de Chromium)
      try { await client.destroy().catch(() => {}); } catch {}
      try { client.pupPage?.browser()?.close().catch(() => {}); } catch {}
      
      setTimeout(() => createClient(sessionId), 5000);
    });

    client.on('message', async (msg) => {
      let contactName = '';
      let avatarUrl = null;
      try {
        const contact = await msg.getContact();
        contactName = contact.pushname || contact.name || '';
        avatarUrl = await client.getProfilePicUrl(msg.from).catch(() => null);
      } catch {}
      const payload = {
        id: msg.id?._serialized || Math.random().toString(36),
        from: msg.from,
        body: msg.body,
        timestamp: msg.timestamp,
        fromMe: false,
        contactName,
        avatarUrl,
        hasMedia: msg.hasMedia,
        type: msg.type
      };
      if (ioRef) ioRef.emit(`whatsapp:message:${sessionId}`, payload);
      if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:message', payload);
    });

    client.on('message_create', async (msg) => {
      // Solo mensajes enviados por nosotros (fromMe)
      if (!msg.fromMe) return;
      const payload = {
        id: msg.id?._serialized || Math.random().toString(36),
        from: msg.to,
        body: msg.body,
        timestamp: msg.timestamp,
        fromMe: true,
        contactName: '',
        hasMedia: msg.hasMedia,
        type: msg.type
      };
      if (ioRef) ioRef.emit(`whatsapp:message_sent:${sessionId}`, payload);
    });

    client.initialize().catch(err => {
      console.error(`Error inicializando WhatsApp [${sessionId}]:`, err);
      sessionStatus.state = 'ERROR';
    });

  } catch (err) {
    console.error(`Error creando cliente WhatsApp [${sessionId}]:`, err);
  }
}

/**
 * Convierte cualquier formato de teléfono al chatId de WhatsApp Web.js
 * Reglas:
 *   1. Elimina todo lo que no sea dígito
 *   2. NO añade código de país a ciegas — respeta el número tal como viene
 *   3. Si tiene 0 dígitos → error claro
 * Ejemplos correctos en datos guardados:
 *   "+573006204200"  →  "573006204200@c.us"  ✓ Colombia con código
 *   "573006204200"   →  "573006204200@c.us"  ✓ Colombia con código
 *   "3006204200"     →  "3006204200@c.us"    ← sin código, puede fallar en WA
 *   "+3006204200"    →  "3006204200@c.us"    ← sin código real, idem
 */
/**
 * Normaliza un teléfono a dígitos puros.
 * Para Colombia: si tiene 10 dígitos y empieza con 3 → añade 57.
 * Nunca mutila ni inventa dígitos.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // Añadir código de país Colombia (57) solo si el número tiene 10 dígitos y empieza con 3
  // (número local colombiano sin código de país)
  if (digits.length === 10 && digits.startsWith('3')) {
    digits = '57' + digits;
  }
  return digits;
}

function formatPhoneForWA(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return digits + '@c.us';
}

/**
 * Obtiene el chatId REAL de WhatsApp para un número.
 * Usa getNumberId() que es la consulta más fiable:
 *   - Si retorna un ID válido → el número SÍ tiene WhatsApp
 *   - Si retorna null       → el número NO está registrado en WA
 *   - Si lanza excepción    → estado desconocido (no podemos concluir nada)
 *
 * Retorna: { chatId, confirmed: true/false/null }
 *   confirmed = true  → tiene WA (getNumberId exitoso)
 *   confirmed = false → no tiene WA (getNumberId retornó null)
 *   confirmed = null  → error/desconocido (no bloquear por esto)
 */
async function getValidChatId(client, phone) {
  const rawChatId = formatPhoneForWA(phone);
  if (!rawChatId) return { chatId: null, confirmed: false };

  try {
    const contactId = await client.getNumberId(rawChatId);
    if (contactId) {
      // ✅ Número confirmado en WhatsApp
      // Retornamos rawChatId SIEMPRE para evitar el bug de '@lid' y hashes irreconocibles ('No LID for user')
      return { chatId: rawChatId, confirmed: true };
    }
    // getNumberId retornó null → número NO registrado
    return { chatId: rawChatId, confirmed: false };
  } catch (e) {
    // Error de red/timeout/puppeteer → no sabemos, retornar chatId raw sin confirmar
    console.warn(`[getValidChatId] Error verificando ${rawChatId}: ${e.message?.slice(0, 60)}`);
    return { chatId: rawChatId, confirmed: null };
  }
}

/**
 * Verifica si el cliente puppeteer sigue activo (no solo el flag connected).
 */
async function isClientReady(client) {
  try {
    if (!client || !client.pupPage) return false;
    // Ping rápido al browser para verificar que la página sigue activa
    await client.pupPage.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Envío con reintentos (3 intentos, 5s entre cada uno).
 * Detecta si el cliente está caído y lanza error claro.
 */
async function sendWithRetry(client, chatId, payload, sessionId, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const ready = await isClientReady(client);
    if (!ready) {
      throw new Error(`[WA:${sessionId}] Puppeteer caído — cliente no responde (intento ${i}/${attempts})`);
    }
    try {
      let result;
      if (typeof payload === 'string') {
        result = await client.sendMessage(chatId, payload);
      } else {
        // payload = { media, options }
        result = await client.sendMessage(chatId, payload.media, payload.options || {});
      }
      const msgId = result?.id?.id || result?.id?._serialized || 'N/A';
      console.log(`[WA:${sessionId}] ✅ Enviado a ${chatId} (intento ${i}). ID: ${msgId}`);
      return { success: true, msgId };
    } catch (err) {
      console.error(`[WA:${sessionId}] ❌ Intento ${i}/${attempts} FALLÓ para ${chatId}: ${err.message}`);
      if (i < attempts) {
        await new Promise(r => setTimeout(r, 5000));
      } else {
        throw new Error(`sendMessage falló ${attempts} veces para ${chatId}: ${err.message}`);
      }
    }
  }
}

async function sendMessage(phone, message, imageUrl = null, sessionId = DEFAULT_SESSION_ID) {
  const session = sessions.get(sessionId);
  if (!session || !session.client || !session.status.connected) throw new Error(`WhatsApp no está conectado [${sessionId}]`);

  const { chatId } = await getValidChatId(session.client, phone);
  if (!chatId) throw new Error(`Número de teléfono inválido: "${phone}"`);

  console.log(`[WA:${sessionId}] Enviando a ${chatId}`);

  if (imageUrl) {
    const imagePath = path.join(__dirname, '..', imageUrl.replace(/^\//, ''));
    const media = MessageMedia.fromFilePath(imagePath);
    return await sendWithRetry(session.client, chatId, { media, options: { caption: message } }, sessionId);
  } else {
    return await sendWithRetry(session.client, chatId, message, sessionId);
  }
}

/**
 * Envía SOLO la imagen (sin caption).
 * El texto se manda después con sendTextOnly.
 */
async function sendImage(phone, imageUrl, sessionId = DEFAULT_SESSION_ID) {
  const session = sessions.get(sessionId);
  if (!session || !session.client || !session.status.connected) throw new Error(`WhatsApp no está conectado [${sessionId}]`);
  
  const { chatId } = await getValidChatId(session.client, phone);
  if (!chatId) throw new Error(`Número inválido: "${phone}"`);

  const imagePath = path.join(__dirname, '..', imageUrl.replace(/^\//, ''));
  const media = MessageMedia.fromFilePath(imagePath);
  return await sendWithRetry(session.client, chatId, { media, options: {} }, sessionId);
}

/**
 * Envía SOLO texto (sin imagen).
 * Usado para el multi-mensaje.
 */
async function sendTextOnly(phone, message, sessionId = DEFAULT_SESSION_ID) {
  const session = sessions.get(sessionId);
  if (!session || !session.client || !session.status.connected) throw new Error(`WhatsApp no está conectado [${sessionId}]`);
  
  const { chatId } = await getValidChatId(session.client, phone);
  if (!chatId) throw new Error(`Número inválido: "${phone}"`);

  return await sendWithRetry(session.client, chatId, message, sessionId);
}

/**
 * Verifica si un número tiene WhatsApp.
 *
 * Retorna:
 *   true  → Confirmado: el número tiene WhatsApp
 *   false → Confirmado: el número NO tiene WhatsApp
 *   null  → Desconocido: error de red / timeout / WA inestable
 *           (NO bloquear envío por esto)
 *
 * Usa getNumberId() como fuente primaria de verdad:
 *   - Si retorna un ID real → true (número registrado en WA)
 *   - Si retorna null      → false (no registrado)
 *   - Si lanza excepción  → null (desconocido, no asumir nada)
 */
async function checkNumber(phone, sessionId = DEFAULT_SESSION_ID) {
  const session = sessions.get(sessionId);
  // Si WA no está conectado, es desconocido — retornar null, no false
  if (!session || !session.client || !session.status.connected) return null;

  const digits = normalizePhone(phone);
  if (!digits) return false; // Número imposible → definitivamente no

  const rawChatId = digits + '@c.us';

  try {
    const contactId = await session.client.getNumberId(rawChatId);
    if (contactId) {
      // getNumberId retornó un ID real → Número confirmado en WA
      console.log(`[checkNumber] ✅ ${rawChatId} confirmado en WA (hash interno: ${contactId._serialized})`);
      return true;
    }
    // getNumberId retornó null → Número definitivamente NO en WA
    console.log(`[checkNumber] ❌ ${rawChatId} → no registrado en WA`);
    return false;
  } catch (e) {
    // Error real (timeout, página caída, etc.) → desconocido, NO asumir false
    console.warn(`[checkNumber] ⚠️ ${rawChatId} → error desconocido: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

async function logout(sessionId = DEFAULT_SESSION_ID) {
  const session = sessions.get(sessionId);
  if (session && session.client) {
    await session.client.logout();
    Object.assign(session.status, { connected: false, phone: null, name: null, qr: null, state: 'DISCONNECTED' });
    if (ioRef) ioRef.emit(`whatsapp:status:${sessionId}`, session.status);
    if (sessionId === DEFAULT_SESSION_ID && ioRef) ioRef.emit('whatsapp:status', session.status);
  }
}

function getStatus(sessionId = DEFAULT_SESSION_ID) { 
  return sessions.get(sessionId)?.status || { connected: false, state: 'DISCONNECTED', sessionId }; 
}

function getAllStatuses() {
  return Array.from(sessions.values()).map(s => s.status);
}

function getClient(sessionId = DEFAULT_SESSION_ID) { 
  return sessions.get(sessionId)?.client; 
}

function createNewSession(sessionId) {
  if (!sessions.has(sessionId)) createClient(sessionId);
  return getStatus(sessionId);
}

async function getChats(sessionId = DEFAULT_SESSION_ID, limit = 30) {
  const session = sessions.get(sessionId);
  if (!session || !session.client || !session.status.connected) return [];
  try {
    const chats = await session.client.getChats();
    return await Promise.all(
      chats.slice(0, limit).map(async (chat) => {
        let avatarUrl = null;
        try { avatarUrl = await session.client.getProfilePicUrl(chat.id._serialized); } catch {}
        return {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
          lastMessage: chat.lastMessage ? {
            body: chat.lastMessage.body?.slice(0, 80) || '',
            fromMe: chat.lastMessage.fromMe,
            timestamp: chat.lastMessage.timestamp
          } : null,
          unreadCount: chat.unreadCount,
          avatarUrl,
          timestamp: chat.timestamp
        };
      })
    );
  } catch (e) {
    console.warn('[getChats]', e.message);
    return [];
  }
}

async function getChatMessages(chatId, sessionId = DEFAULT_SESSION_ID, limit = 60) {
  const session = sessions.get(sessionId);
  if (!session || !session.client || !session.status.connected) {
    throw new Error('Sesión no conectada');
  }
  const client = session.client;

  // ── Estrategia 1: Store.Chat.get directo (síncrono) ──────────
  try {
    const result = await client.pupPage.evaluate((chatId, limit) => {
      try {
        const Store = window.Store;
        if (!Store) return { err: 'Store no disponible' };
        const chat = Store.Chat?.get(chatId) || Store.Chats?.get(chatId);
        if (!chat) return { err: 'Chat no encontrado: ' + chatId };
        const models = chat.msgs?.models || chat.msgs?._models || [];
        const msgs = models.slice(-limit).map(m => ({
          id: m.id?.id || '',
          body: String(m.body || m.caption || '').slice(0, 500),
          fromMe: !!m.id?.fromMe,
          timestamp: m.t || m.timestamp || 0,
          type: m.type || 'chat',
          hasMedia: !!(m.mediaData || m.filehash)
        }));
        return { err: null, msgs, total: models.length };
      } catch (e) {
        return { err: e.message };
      }
    }, chatId, limit);

    console.log(`[getChatMessages E1]`, result?.err || `OK: ${result?.msgs?.length} msgs`);
    if (!result.err && result.msgs) return result.msgs;
  } catch (e) {
    console.warn('[getChatMessages E1 excepción]', e.message?.slice(0, 80));
  }

  // ── Estrategia 2: buscar en chat.msgs.models iterando todos ──
  try {
    const msgs = await client.pupPage.evaluate((chatId, limit) => {
      try {
        const Store = window.Store;
        const allChats = Store?.Chat?.models || Store?.Chats?.models || [];
        const chat = allChats.find(c =>
          c.id?._serialized === chatId ||
          (c.id?.user && chatId.startsWith(c.id.user))
        );
        if (!chat) return null;
        const models = chat.msgs?.models || [];
        return models.slice(-limit).map(m => ({
          id: m.id?.id || '',
          body: String(m.body || m.caption || '').slice(0, 500),
          fromMe: !!m.id?.fromMe,
          timestamp: m.t || m.timestamp || 0,
          type: m.type || 'chat',
          hasMedia: false
        }));
      } catch (e) { return null; }
    }, chatId, limit);

    console.log(`[getChatMessages E2]`, msgs === null ? 'chat no hallado' : `${msgs.length} msgs`);
    if (msgs && msgs.length > 0) return msgs;
  } catch (e) {
    console.warn('[getChatMessages E2 excepción]', e.message?.slice(0, 80));
  }

  // ── Estrategia 3: diagnóstico — qué Store existe ──────────────
  try {
    const info = await client.pupPage.evaluate(() => {
      const s = window.Store;
      if (!s) return 'window.Store = undefined';
      const keys = Object.keys(s).slice(0, 20).join(', ');
      const chatCount = s.Chat?.models?.length || s.Chats?.models?.length || 0;
      return `Store keys: ${keys} | chats: ${chatCount}`;
    });
    console.warn('[getChatMessages E3 info]', info);
  } catch (e) {
    console.warn('[getChatMessages E3]', e.message?.slice(0, 80));
  }

  throw new Error('Sin mensajes cargados en esta sesión. Abre el chat en el teléfono y refresca.');
}

module.exports = { 
  init, sendMessage, sendImage, sendTextOnly, checkNumber, logout, 
  getStatus, getAllStatuses, getClient, createNewSession, getChats, getChatMessages
};
