require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 15000
});

// ── Middlewares ─────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Directorios ─────────────────────────────────────────────
fs.ensureDirSync(path.join(__dirname, 'uploads'));
fs.ensureDirSync(path.join(__dirname, 'data'));

// ── Archivos de datos ───────────────────────────────────────
const DATA_FILE      = path.join(__dirname, 'data', 'prospects.json');
const CAMPAIGNS_FILE = path.join(__dirname, 'data', 'campaigns.json');
const TEMPLATES_FILE = path.join(__dirname, 'data', 'templates.json');
const LISTS_FILE     = path.join(__dirname, 'data', 'lists.json');
const SESSIONS_FILE  = path.join(__dirname, 'data', 'sessions.json');

// ── Cache de datos en memoria (evita leer del disco en cada request) ─
const memCache = {
  prospects: null,
  campaigns: null,
  templates: null,
  lists: null,
  sessions: null,
  dirty: { prospects: false, campaigns: false, templates: false, lists: false, sessions: false }
};

function loadData(file) {
  try {
    if (fs.existsSync(file)) return fs.readJsonSync(file);
    fs.writeJsonSync(file, []);
    return [];
  } catch { return []; }
}

// Inicializa caché en memoria al arrancar
function bootCache() {
  memCache.prospects = loadData(DATA_FILE);
  memCache.campaigns = loadData(CAMPAIGNS_FILE);
  memCache.templates = loadData(TEMPLATES_FILE);
  memCache.lists     = loadData(LISTS_FILE);
  memCache.sessions  = loadData(SESSIONS_FILE);
  
  // Create default list if it doesn't exist
  if (memCache.lists.length === 0) {
    memCache.lists.push({ id: 'default', name: 'Lista General', createdAt: new Date().toISOString() });
    fs.writeJsonSync(LISTS_FILE, memCache.lists);
  }
}

// Guardar solo el archivo correspondiente (async, no bloquea)
function saveAsync(key, file) {
  if (memCache.dirty[key]) return; // ya hay un write pendiente
  memCache.dirty[key] = true;
  setImmediate(async () => {
    try {
      await fs.outputJson(file, memCache[key], { spaces: 2 });
    } catch (e) {
      console.error('[save]', key, e.message);
    } finally {
      memCache.dirty[key] = false;
    }
  });
}

function getProspects()  { return memCache.prospects; }
function getCampaigns()  { return memCache.campaigns; }
function getTemplates()  { return memCache.templates; }
function getLists()      { return memCache.lists; }
function getSessions()   { return memCache.sessions; }

function saveProspects() { saveAsync('prospects', DATA_FILE); }
function saveCampaigns() { saveAsync('campaigns', CAMPAIGNS_FILE); }
function saveTemplates() { saveAsync('templates', TEMPLATES_FILE); }
function saveLists()     { saveAsync('lists', LISTS_FILE); }
function saveSessions()  { saveAsync('sessions', SESSIONS_FILE); }

bootCache();

// ── Módulos ─────────────────────────────────────────────────
const whatsappManager = require('./modules/whatsappManager');
whatsappManager.init(io);

const searchModule = require('./modules/searchModule');
const instagramSearch = require('./modules/instagramSearch');

const campaignManager = require('./modules/campaignManager');
campaignManager.init(io, whatsappManager, { getProspects, getCampaigns, saveProspects, saveCampaigns });

// ════════════════════════════════════════════════════════════
// API — Dashboard
// ════════════════════════════════════════════════════════════
app.get('/api/stats', (req, res) => {
  const { sessionId } = req.query;
  let prospects = getProspects();
  let campaigns = getCampaigns();

  if (sessionId) {
    prospects = prospects.filter(p => p.sessionId === sessionId || !p.sessionId);
    campaigns = campaigns.filter(c => c.sessionId === sessionId || !c.sessionId);
  }
  const sent    = campaigns.reduce((a, c) => a + (c.sent || 0), 0);
  const replied = campaigns.reduce((a, c) => a + (c.replied || 0), 0);
  res.json({
    totalProspects:   prospects.length,
    totalCampaigns:   campaigns.length,
    messagesSent:     sent,
    repliesReceived:  replied,
    conversionRate:   sent > 0 ? ((replied / sent) * 100).toFixed(1) : 0,
    withWebsite:      prospects.filter(p => p.hasWebsite).length,
    withoutWebsite:   prospects.filter(p => !p.hasWebsite).length,
    withInstagram:    prospects.filter(p => p.instagram).length
  });
});

// Stats diarias anti-ban
app.get('/api/stats/daily', (req, res) => {
  res.json(campaignManager.getDailyStats());
});

// ── Nichos (categorías) con estadísticas ──────────────────────
app.get('/api/niches', (req, res) => {
  const { sessionId } = req.query;
  let prospects = getProspects();
  let campaigns = getCampaigns();

  if (sessionId) {
    prospects = prospects.filter(p => p.sessionId === sessionId || !p.sessionId);
    campaigns = campaigns.filter(c => c.sessionId === sessionId || !c.sessionId);
  }

  const nicheMap = {};
  for (const p of prospects) {
    const n = p.niche || 'Sin nicho';
    if (!nicheMap[n]) {
      nicheMap[n] = { name: n, total: 0, new: 0, contacted: 0, replied: 0, converted: 0, withPhone: 0, withWebsite: 0, withInstagram: 0 };
    }
    nicheMap[n].total++;
    const st = p.status || 'new';
    if (nicheMap[n][st] !== undefined) nicheMap[n][st]++;
    if (p.phone) nicheMap[n].withPhone++;
    if (p.hasWebsite) nicheMap[n].withWebsite++;
    if (p.instagram) nicheMap[n].withInstagram++;
  }

  // Asociar campañas activas por nicho
  for (const c of campaigns) {
    if (c.nicheFilter && nicheMap[c.nicheFilter]) {
      nicheMap[c.nicheFilter].activeCampaign = c.status === 'running' ? c.name : null;
    }
  }

  const niches = Object.values(nicheMap).sort((a, b) => b.total - a.total);
  res.json(niches);
});

// ── Campañas activas en tiempo real ──────────────────────────
app.get('/api/campaigns/active', (req, res) => {
  const activeIds = campaignManager.getActiveCampaigns();
  res.json({ active: activeIds, count: activeIds.length });
});

// ════════════════════════════════════════════════════════════
// API — Search (con progreso en tiempo real vía Socket.IO)
// ════════════════════════════════════════════════════════════

// Evitar búsquedas simultáneas
const activeSearches = new Map();

app.post('/api/search', (req, res) => {
  const { query, location, source = 'maps', maxResults = 20, sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId es requerido' });

  if (activeSearches.get(sessionId)) {
    return res.status(429).json({ success: false, error: `Ya hay una búsqueda en curso en el entorno ${sessionId}. Espera a que termine.` });
  }

  if (!query?.trim() || !location?.trim()) {
    return res.status(400).json({ success: false, error: 'query y location son requeridos' });
  }

  activeSearches.set(sessionId, true);
  io.emit('search:start', { sessionId, query, location, source });
  
  // Responder Inmediatamente (Background Job)
  res.json({ success: true, message: `Búsqueda iniciada en el entorno ${sessionId}` });

  // Ejecutar búsqueda asíncrona
  setImmediate(async () => {
    try {
      let results = [];
      const max = Math.min(parseInt(maxResults) || 20, 100);

      if (source === 'instagram') {
        results = await instagramSearch.searchInstagram(
          query.trim(),
          location.trim(),
          max,
          ({ pct, text }) => io.emit('search:progress', { sessionId, pct, text })
        );
      } else {
        results = await searchModule.search({
          query: query.trim(),
          location: location.trim(),
          maxResults: max,
          onProgress: ({ pct, text }) => io.emit('search:progress', { sessionId, pct, text })
        });
      }

      // Pre-validación de WhatsApp
      io.emit('search:progress', { sessionId, pct: 85, text: 'Validando números en WhatsApp...' });
      const validatedResults = [];

      const allStatuses = whatsappManager.getAllStatuses();
      const connectedSession = allStatuses.find(s => s.connected);
      const validatorSessionId = connectedSession ? connectedSession.sessionId : null;

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.phone && validatorSessionId) {
          // checkNumber retorna: true=tiene WA | false=no tiene WA | null=desconocido
          const waResult = await whatsappManager.checkNumber(r.phone, validatorSessionId);
          r.hasWhatsapp = waResult; // null = desconocido (NO mostrar como "Sin WhatsApp")
          const pct = 85 + Math.round(((i + 1) / results.length) * 12);
          const statusTxt = waResult === true ? '✅ WA verificado' : waResult === false ? '❌ Sin WA' : '❓ Sin verificar';
          io.emit('search:progress', { sessionId, pct, text: `Verificando ${i + 1}/${results.length}: ${statusTxt}` });
        } else {
          // Sin sesión conectada o sin teléfono → desconocido
          r.hasWhatsapp = null;
        }
        validatedResults.push(r);
      }

      // Filtro de duplicados ya contactados o en base de datos para esta sesión
      const existingProspects = getProspects();
      const contactedPhones = new Set(
        existingProspects
          .filter(p => p.phone && p.status !== 'new' && (p.sessionId === sessionId || !p.sessionId))
          .map(p => p.phone)
      );

      let duplicatesRemoved = 0;
      const finalResults = [];
      
      for (const r of validatedResults) {
        if (r.phone && contactedPhones.has(r.phone)) {
          duplicatesRemoved++;
        } else {
          finalResults.push(r);
        }
      }
      
      if (duplicatesRemoved > 0) {
        io.emit('search:duplicates_removed', { sessionId, count: duplicatesRemoved });
      }

      io.emit('search:complete', { sessionId, count: finalResults.length });
      
      // Emit the final results so the frontend can catch them
      io.emit('search:results_ready', { sessionId, results: finalResults, duplicatesRemoved });

    } catch (err) {
      console.error('[search job]', err.message);
      io.emit('search:error', { sessionId, message: err.message });
    } finally {
      activeSearches.set(sessionId, false);
    }
  });
});

// (List endpoints removed)

// ════════════════════════════════════════════════════════════
// API — Prospects
// ════════════════════════════════════════════════════════════
app.get('/api/prospects', (req, res) => {
  const { status, niche, sessionId, page = 1, limit = 200 } = req.query;
  let list = getProspects();
  if (status) list = list.filter(p => p.status === status);
  if (niche)  list = list.filter(p => p.niche  === niche);
  if (sessionId) list = list.filter(p => p.sessionId === sessionId || !p.sessionId);

  const total  = list.length;
  const start  = (parseInt(page) - 1) * parseInt(limit);
  const paged  = list.slice(start, start + parseInt(limit));
  res.json({ data: paged, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
});

app.post('/api/prospects', (req, res) => {
  const prospects = getProspects();
  const p = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString(), status: 'new', sessionId: req.body.sessionId || 'session-1' };
  prospects.push(p);
  saveProspects();
  io.emit('prospects:updated', { count: prospects.length });
  res.json({ success: true, prospect: p });
});

app.post('/api/prospects/bulk', (req, res) => {
  const { prospects: incoming = [], sessionId = 'session-1' } = req.body;
  const existing  = getProspects();
  
  // Only check uniqueness within the same sessionId
  const sessionProspects = existing.filter(p => p.sessionId === sessionId || !p.sessionId);
  const phonesSet = new Set(sessionProspects.map(p => p.phone).filter(Boolean));

  const added = [];
  for (const p of incoming) {
    if (p.phone && phonesSet.has(p.phone)) continue;
    const np = { ...p, id: p.id || uuidv4(), createdAt: new Date().toISOString(), status: p.status || 'new', sessionId };
    existing.push(np);
    added.push(np);
    if (p.phone) phonesSet.add(p.phone);
  }

  saveProspects();
  io.emit('prospects:updated', { count: existing.length });
  res.json({ success: true, added: added.length, total: existing.length });
});

app.put('/api/prospects/:id', (req, res) => {
  const prospects = getProspects();
  const idx = prospects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  prospects[idx] = { ...prospects[idx], ...req.body };
  saveProspects();
  res.json({ success: true });
});

app.delete('/api/prospects/:id', (req, res) => {
  const prospects = getProspects();
  const idx = prospects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  prospects.splice(idx, 1);
  saveProspects();
  io.emit('prospects:updated', { count: prospects.length });
  res.json({ success: true });
});

// Borrar múltiples
app.post('/api/prospects/delete-bulk', (req, res) => {
  const { ids = [] } = req.body;
  const idSet = new Set(ids);
  const prospects = getProspects();
  const before = prospects.length;
  const filtered = prospects.filter(p => !idSet.has(p.id));
  memCache.prospects = filtered;
  saveProspects();
  io.emit('prospects:updated', { count: filtered.length });
  res.json({ success: true, deleted: before - filtered.length });
});

// ════════════════════════════════════════════════════════════
// API — Campaigns
// ════════════════════════════════════════════════════════════
app.get('/api/campaigns', (req, res) => {
  const { sessionId } = req.query;
  let campaigns = getCampaigns();
  if (sessionId) {
    campaigns = campaigns.filter(c => c.sessionId === sessionId || !c.sessionId);
  }
  res.json(campaigns);
});

app.post('/api/campaigns', (req, res) => {
  const campaigns = getCampaigns();
  const c = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString(), status: 'draft', sent: 0, replied: 0 };
  
  if (c.scheduledAt) {
    if (new Date(c.scheduledAt) > new Date()) {
      c.status = 'scheduled';
    }
  }

  campaigns.push(c);
  saveCampaigns();
  io.emit('campaigns:updated');
  res.json({ success: true, campaign: c });
});

app.put('/api/campaigns/:id', (req, res) => {
  const campaigns = getCampaigns();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  campaigns[idx] = { ...campaigns[idx], ...req.body };
  saveCampaigns();
  res.json({ success: true, campaign: campaigns[idx] });
});

app.delete('/api/campaigns/:id', (req, res) => {
  const campaigns = getCampaigns();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  campaigns.splice(idx, 1);
  saveCampaigns();
  res.json({ success: true });
});

app.post('/api/campaigns/:id/start', async (req, res) => {
  try {
    const r = await campaignManager.startCampaign(req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    const r = await campaignManager.pauseCampaign(req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// API — Templates
// ════════════════════════════════════════════════════════════
app.get('/api/templates', (req, res) => res.json(getTemplates()));

app.post('/api/templates', (req, res) => {
  const templates = getTemplates();
  const t = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString() };
  templates.push(t);
  saveTemplates();
  res.json({ success: true, template: t });
});

app.put('/api/templates/:id', (req, res) => {
  const templates = getTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  templates[idx] = { ...templates[idx], ...req.body };
  saveTemplates();
  res.json({ success: true });
});

app.delete('/api/templates/:id', (req, res) => {
  const templates = getTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  templates.splice(idx, 1);
  saveTemplates();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
// API — WhatsApp
// ════════════════════════════════════════════════════════════
app.get('/api/whatsapp/status', (req, res) => res.json(whatsappManager.getStatus()));
app.get('/api/whatsapp/sessions', (req, res) => res.json(whatsappManager.getAllStatuses()));

app.post('/api/whatsapp/sessions/:id/init', (req, res) => {
  res.json(whatsappManager.createNewSession(req.params.id));
});

app.post('/api/whatsapp/sessions/:id/logout', async (req, res) => {
  try { await whatsappManager.logout(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WhatsApp Chats (para el visor en tiempo real) ───────────
app.get('/api/whatsapp/sessions/:id/chats', async (req, res) => {
  try {
    const chats = await whatsappManager.getChats(req.params.id, 40);
    res.json({ success: true, chats });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// chatId va como query param para evitar problemas con @c.us en la URL
app.get('/api/whatsapp/sessions/:id/messages', async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) return res.status(400).json({ success: false, error: 'chatId requerido' });
    const messages = await whatsappManager.getChatMessages(chatId, req.params.id, 60);
    res.json({ success: true, messages });
  } catch (e) {
    console.error('[/api/messages]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try { await whatsappManager.logout(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WA Live Screen — Captura de pantalla Puppeteer ──────────
// Viewport fijo para que el cálculo de coordenadas sea predecible
const WA_SCREEN_W = 1280, WA_SCREEN_H = 800;

app.get('/api/whatsapp/sessions/:id/screen', async (req, res) => {
  try {
    const client = whatsappManager.getClient(req.params.id);
    if (!client || !client.pupPage) return res.status(503).json({ error: 'Sesión no disponible o no inicializada' });

    // Asegurar viewport correcto (idempotente)
    await client.pupPage.setViewport({ width: WA_SCREEN_W, height: WA_SCREEN_H }).catch(() => {});

    const shot = await client.pupPage.screenshot({ type: 'jpeg', quality: 72, encoding: 'base64' });
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.json({ img: 'data:image/jpeg;base64,' + shot, vw: WA_SCREEN_W, vh: WA_SCREEN_H, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WA Live Screen — Click del ratón ────────────────────────
app.post('/api/whatsapp/sessions/:id/screen/click', async (req, res) => {
  try {
    const { x, y, button = 'left' } = req.body;
    const client = whatsappManager.getClient(req.params.id);
    if (!client || !client.pupPage) return res.status(503).json({ error: 'No disponible' });
    await client.pupPage.mouse.click(Number(x), Number(y), { button });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WA Live Screen — Teclado ─────────────────────────────────
app.post('/api/whatsapp/sessions/:id/screen/keyboard', async (req, res) => {
  try {
    const { text, key } = req.body;
    const client = whatsappManager.getClient(req.params.id);
    if (!client || !client.pupPage) return res.status(503).json({ error: 'No disponible' });
    if (key)  await client.pupPage.keyboard.press(String(key));
    else if (text) await client.pupPage.keyboard.type(String(text), { delay: 25 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WA Live Screen — Scroll ──────────────────────────────────
app.post('/api/whatsapp/sessions/:id/screen/scroll', async (req, res) => {
  try {
    const { x, y, deltaY } = req.body;
    const client = whatsappManager.getClient(req.params.id);
    if (!client || !client.pupPage) return res.status(503).json({ error: 'No disponible' });
    await client.pupPage.mouse.move(Number(x), Number(y));
    await client.pupPage.evaluate((dy) => window.scrollBy(0, dy), Number(deltaY));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload de imágenes ──────────────────────────────────────
const multer = require('multer');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, 'uploads/'),
    filename:    (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// ── Cache clear (debug) ─────────────────────────────────────
app.post('/api/cache/clear', (req, res) => {
  searchModule.clearCache();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
// Socket.IO — conexión + screen streaming
// ════════════════════════════════════════════════════════════
const screenStreams = new Map(); // socketId → intervalId

io.on('connection', (socket) => {
  socket.emit('whatsapp:status', whatsappManager.getStatus());
  socket.emit('prospects:count', { count: getProspects().length });

  // ── Screen stream: el cliente se suscribe ───────────────
  socket.on('screen:subscribe', async ({ sessionId }) => {
    // Detener stream previo del mismo socket
    if (screenStreams.has(socket.id)) {
      clearInterval(screenStreams.get(socket.id));
    }

    const sendFrame = async () => {
      const client = whatsappManager.getClient(sessionId);
      if (!client || !client.pupPage) return;
      try {
        await client.pupPage.setViewport({ width: 1280, height: 800 }).catch(() => {});
        const img = await client.pupPage.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' });
        socket.emit(`screen:frame:${sessionId}`, { img: 'data:image/jpeg;base64,' + img });
      } catch (e) { /* puppeteer ocupado */ }
    };

    // Enviar primer frame inmediato
    await sendFrame();
    const iv = setInterval(sendFrame, 520);
    screenStreams.set(socket.id, iv);

    socket.on('screen:unsubscribe', () => {
      clearInterval(iv);
      screenStreams.delete(socket.id);
    });
  });

  socket.on('disconnect', () => {
    if (screenStreams.has(socket.id)) {
      clearInterval(screenStreams.get(socket.id));
      screenStreams.delete(socket.id);
    }
  });
});

// ── SPA Fallback ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler global ────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Prospector AI → http://localhost:${PORT}\n`);
});

// Exportar accesores para módulos
module.exports = { io, getProspects, getCampaigns, saveProspects, saveCampaigns, DATA_FILE, CAMPAIGNS_FILE, TEMPLATES_FILE };
