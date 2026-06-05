// ── Guardia global — evita que errores de Puppeteer/WA maten el proceso ──
process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  // Errores conocidos de Puppeteer/WA que son recuperables — solo loguear
  const ignorable = [
    'detached Frame', 'Navigating frame was detached', 'Protocol error',
    'Session closed', 'Target closed', 'Connection closed', 'Browser closed',
    'Page crashed', 'net::ERR_', 'Cannot call method', 'Execution context',
    'context was destroyed', 'read ECONNRESET', 'write EPIPE', 'ECONNREFUSED',
  ];
  if (ignorable.some(k => msg.includes(k))) {
    console.warn(`[Process] ⚠️ Excepción ignorada (Puppeteer): ${msg}`);
    return;
  }
  console.error('[Process] 🚨 uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message || reason || '');
  const ignorable = [
    'detached Frame', 'Navigating frame was detached', 'Protocol error',
    'Session closed', 'Target closed', 'Connection closed', 'Browser closed',
    'Page crashed', 'net::ERR_', 'Cannot call method', 'Execution context',
    'context was destroyed', 'read ECONNRESET', 'write EPIPE', 'ECONNREFUSED',
  ];
  if (ignorable.some(k => msg.includes(k))) {
    console.warn(`[Process] ⚠️ Promise ignorada (Puppeteer): ${msg}`);
    return;
  }
  console.error('[Process] 🚨 unhandledRejection:', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  pingTimeout: 30000,
  pingInterval: 15000
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir imágenes subidas
app.use('/uploads', express.static(process.env.UPLOADS_DIR || path.join(__dirname, 'uploads')));

global.io = io;
global.db = db;

// ── Health ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.2.0', db: 'connected' });
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const activeProspects = db.prepare(
    "SELECT count(*) as c FROM prospects WHERE status IN ('new','queued') AND sessionId = ?"
  ).get(sid).c;
  const msgsSent = db.prepare(
    'SELECT coalesce(sum(sent),0) as s FROM campaigns WHERE sessionId = ?'
  ).get(sid).s;
  const unreadReplies = db.prepare(
    'SELECT count(*) as c FROM replies WHERE sessionId = ? AND isRead = 0'
  ).get(sid).c;
  const wonProspects = db.prepare(
    "SELECT count(*) as c FROM prospects WHERE sessionId = ? AND stage = 'won'"
  ).get(sid).c;
  res.json({ success: true, activeProspects, msgsSent, unreadReplies, wonProspects });
});

// ── Search / Scraping ─────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, location, maxResults, sources } = req.body;
  const sessionId = req.body.sessionId || 'session-1';

  if (!query || !location) return res.status(400).json({ error: 'Query y location son requeridos' });

  const SEARCH_TIMEOUT_MS = 5 * 60 * 1000;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    global.io?.emit(`search:progress:${sessionId}`, { pct: 100, text: '❌ Tiempo límite de búsqueda superado (5 min)' });
    if (!res.headersSent) res.json({ success: false, error: 'Search timeout' });
  }, SEARCH_TIMEOUT_MS);

  try {
    const { search } = require('./modules/searchModule');
    const results = await search({
      query, location,
      maxResults: maxResults || 20,
      sources: sources || ['google_maps'],
      onProgress: (prog) => {
        if (!timedOut) global.io?.emit(`search:progress:${sessionId}`, prog);
      }
    });

    clearTimeout(timeoutId);
    if (timedOut) return;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO prospects
        (id, name, phone, email, city, niche, hasWebsite, website, instagram, address, lat, lon, score, rating, reviews, source, notes, sessionId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    db.transaction(() => {
      for (const p of results) {
        if (!p.phone && !p.name) continue;
        stmt.run(
          p.id, p.name, p.phone || '', p.email || '', location,
          p.niche || 'Negocio Local', p.hasWebsite ? 1 : 0,
          p.website || '', p.instagram || '', p.address || '',
          p.lat || null, p.lon || null,
          p.score || 50, p.rating || null, p.reviews || '0',
          p.source || 'google_maps', p.notes || '', sessionId
        );
        inserted++;
      }
    })();

    global.io?.emit(`search:progress:${sessionId}`, {
      pct: 100,
      text: `✅ ${inserted} nuevos prospectos guardados.`
    });
    res.json({ success: true, total: results.length, inserted });

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[Search Error]', err);
    global.io?.emit(`search:progress:${sessionId}`, { pct: 100, text: `❌ Error: ${err.message}` });
    if (!res.headersSent) res.json({ success: false, error: err.message });
  }
});

// ── WhatsApp ──────────────────────────────────────────────────
app.post('/api/wa/reset', async (req, res) => {
  const sid = req.query.sessionId || req.body.sessionId || 'session-1';
  try {
    await require('./modules/whatsappManager').resetSession(sid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Upload imagen ─────────────────────────────────────────────
app.post('/api/upload/image', (req, res) => {
  try {
    const multer = require('multer');
    const fs = require('fs');
    const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const storage = multer.diskStorage({
      destination: uploadsDir,
      filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
    });
    const upload = multer({ storage, limits: { fileSize: 16 * 1024 * 1024 } }).single('image');

    upload(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió imagen' });
      const url = `/uploads/${req.file.filename}`;
      res.json({ success: true, url });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Prospects ─────────────────────────────────────────────────
app.get('/api/prospects', (req, res) => {
  const { sessionId = 'session-1', page = 1, limit = 50, filter, niche, status, source, stage } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'sessionId = ?';
  const params = [sessionId];

  if (filter) { where += ' AND (name LIKE ? OR phone LIKE ?)'; params.push(`%${filter}%`, `%${filter}%`); }
  if (niche)   { where += ' AND niche = ?'; params.push(niche); }
  if (status)  { where += ' AND status = ?'; params.push(status); }
  if (source)  { where += ' AND source = ?'; params.push(source); }
  if (stage)   { where += ' AND stage = ?'; params.push(stage); }

  const total = db.prepare(`SELECT count(*) as c FROM prospects WHERE ${where}`).get(...params).c;
  const rows  = db.prepare(`SELECT * FROM prospects WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
                  .all(...params, parseInt(limit), offset);

  res.json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

app.delete('/api/prospects/clear', (req, res) => {
  db.prepare('DELETE FROM prospects WHERE sessionId = ?').run(req.query.sessionId || 'session-1');
  res.json({ success: true });
});

app.delete('/api/prospects/bulk', (req, res) => {
  const { ids, sessionId = 'session-1' } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids requeridos' });
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM prospects WHERE id IN (${placeholders}) AND sessionId = ?`).run(...ids, sessionId);
  res.json({ success: true });
});

// Actualizar stage en lote
app.put('/api/prospects/bulk/stage', (req, res) => {
  const { ids, stage, sessionId = 'session-1' } = req.body;
  if (!Array.isArray(ids) || !ids.length || !stage) return res.status(400).json({ error: 'ids y stage requeridos' });
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE prospects SET stage = ? WHERE id IN (${placeholders}) AND sessionId = ?`)
    .run(stage, ...ids, sessionId);
  // Log actividad en lote
  const stmt = db.prepare('INSERT INTO activities (prospectId, sessionId, type, data) VALUES (?,?,?,?)');
  db.transaction(() => {
    for (const id of ids) {
      stmt.run(id, sessionId, 'stage_changed', JSON.stringify({ stage }));
    }
  })();
  res.json({ success: true });
});

app.get('/api/prospects/export', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const rows = db.prepare('SELECT * FROM prospects WHERE sessionId = ? ORDER BY createdAt DESC').all(sid);
  const header = 'id,name,phone,email,city,niche,stage,status,source,score,website,instagram,address,rating,reviews,createdAt\n';
  const body = rows.map(r =>
    [r.id, r.name, r.phone, r.email, r.city, r.niche, r.stage, r.status, r.source, r.score,
     r.website, r.instagram, r.address, r.rating, r.reviews, r.createdAt]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="prospectos-${sid}-${Date.now()}.csv"`);
  res.send('﻿' + header + body);
});

app.post('/api/prospects/import', (req, res) => {
  const { rows, sessionId = 'session-1' } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array requerido' });
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO prospects (id, name, phone, email, city, niche, website, instagram, source, sessionId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (!r.name && !r.phone) continue;
      stmt.run(uuidv4(), r.name || 'Sin nombre', r.phone || '', r.email || '',
               r.city || '', r.niche || 'Importado', r.website || '', r.instagram || '',
               'csv_import', sessionId);
      imported++;
    }
  })();
  res.json({ success: true, imported });
});

// Datos para mapa
app.get('/api/prospects/map', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const rows = db.prepare(`
    SELECT id, name, phone, niche, stage, score, lat, lon, city
    FROM prospects
    WHERE sessionId = ? AND lat IS NOT NULL AND lon IS NOT NULL
    LIMIT 2000
  `).all(sid);
  res.json({ success: true, data: rows });
});

// ── Prospect individual — Stage, Tags, Notes, Activity ────────
app.put('/api/prospects/:id/stage', (req, res) => {
  const { stage } = req.body;
  const { id } = req.params;
  const sid = req.query.sessionId || req.body.sessionId || 'session-1';
  if (!stage) return res.status(400).json({ error: 'stage requerido' });
  db.prepare('UPDATE prospects SET stage = ? WHERE id = ? AND sessionId = ?').run(stage, id, sid);
  db.prepare('INSERT INTO activities (prospectId, sessionId, type, data) VALUES (?,?,?,?)').run(
    id, sid, 'stage_changed', JSON.stringify({ stage })
  );
  res.json({ success: true });
});

app.put('/api/prospects/:id/tags', (req, res) => {
  const { tags } = req.body;
  const { id } = req.params;
  const sid = req.query.sessionId || req.body.sessionId || 'session-1';
  db.prepare('UPDATE prospects SET tags = ? WHERE id = ? AND sessionId = ?').run(
    JSON.stringify(Array.isArray(tags) ? tags : []), id, sid
  );
  res.json({ success: true });
});

app.get('/api/prospects/:id/notes', (req, res) => {
  const rows = db.prepare('SELECT * FROM prospect_notes WHERE prospectId = ? ORDER BY createdAt DESC').all(req.params.id);
  res.json({ success: true, data: rows });
});

app.post('/api/prospects/:id/notes', (req, res) => {
  const { content, sessionId = 'session-1' } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content requerido' });
  const result = db.prepare('INSERT INTO prospect_notes (prospectId, sessionId, content) VALUES (?,?,?)').run(
    req.params.id, sessionId, content.trim()
  );
  db.prepare('INSERT INTO activities (prospectId, sessionId, type, data) VALUES (?,?,?,?)').run(
    req.params.id, sessionId, 'note', JSON.stringify({ preview: content.slice(0, 60) })
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/prospects/:id/notes/:noteId', (req, res) => {
  db.prepare('DELETE FROM prospect_notes WHERE id = ? AND prospectId = ?').run(req.params.noteId, req.params.id);
  res.json({ success: true });
});

app.get('/api/prospects/:id/activity', (req, res) => {
  const rows = db.prepare('SELECT * FROM activities WHERE prospectId = ? ORDER BY createdAt DESC LIMIT 50').all(req.params.id);
  res.json({ success: true, data: rows });
});

// ── Blacklist ─────────────────────────────────────────────────
app.get('/api/blacklist', (req, res) => {
  const rows = db.prepare('SELECT * FROM blacklist ORDER BY createdAt DESC').all();
  res.json({ success: true, data: rows });
});

app.post('/api/blacklist', (req, res) => {
  const { phone, reason } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requerido' });
  const normalized = String(phone).replace(/\D/g, '');
  try {
    db.prepare('INSERT INTO blacklist (phone, reason) VALUES (?,?)').run(normalized, reason || '');
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.json({ success: true, alreadyExists: true });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/blacklist/:phone', (req, res) => {
  db.prepare('DELETE FROM blacklist WHERE phone = ?').run(req.params.phone);
  res.json({ success: true });
});

app.post('/api/blacklist/import', (req, res) => {
  const { phones } = req.body;
  if (!Array.isArray(phones)) return res.status(400).json({ error: 'phones array requerido' });
  const stmt = db.prepare('INSERT OR IGNORE INTO blacklist (phone) VALUES (?)');
  let added = 0;
  db.transaction(() => {
    for (const p of phones) {
      const norm = String(p).replace(/\D/g, '');
      if (norm.length >= 7) { stmt.run(norm); added++; }
    }
  })();
  res.json({ success: true, added });
});

// ── Sequences ─────────────────────────────────────────────────
app.get('/api/sequences', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const rows = db.prepare('SELECT * FROM sequences WHERE sessionId = ? OR sessionId IS NULL ORDER BY createdAt DESC').all(sid);
  res.json({ success: true, data: rows });
});

app.post('/api/sequences', (req, res) => {
  const { name, steps, sessionId = 'session-1' } = req.body;
  if (!name?.trim() || !Array.isArray(steps)) return res.status(400).json({ error: 'name y steps requeridos' });
  const id = uuidv4();
  db.prepare('INSERT INTO sequences (id, name, steps, sessionId) VALUES (?,?,?,?)').run(
    id, name.trim(), JSON.stringify(steps), sessionId
  );
  res.json({ success: true, id });
});

app.put('/api/sequences/:id', (req, res) => {
  const { name, steps, isActive } = req.body;
  const fields = [], vals = [];
  if (name !== undefined)     { fields.push('name = ?');     vals.push(name); }
  if (steps !== undefined)    { fields.push('steps = ?');    vals.push(JSON.stringify(steps)); }
  if (isActive !== undefined) { fields.push('isActive = ?'); vals.push(isActive ? 1 : 0); }
  if (!fields.length) return res.json({ success: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE sequences SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/sequences/:id', (req, res) => {
  db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── AI ────────────────────────────────────────────────────────
app.post('/api/ai/generate', async (req, res) => {
  try {
    const aiModule = require('./modules/aiModule');
    const variants = await aiModule.generateMessages(req.body);
    res.json({ success: true, variants });
  } catch (err) {
    console.error('[AI] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/improve', async (req, res) => {
  try {
    const aiModule = require('./modules/aiModule');
    const improved = await aiModule.improveMessage(req.body);
    res.json({ success: true, message: improved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Guardar/obtener API key de IA
app.get('/api/settings/ai', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({ success: true, hasKey: !!key, keyPreview: key ? `sk-...${key.slice(-4)}` : '' });
});

app.post('/api/settings/ai', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey?.startsWith('sk-')) return res.status(400).json({ error: 'API key inválida (debe empezar con sk-)' });
  // Guardar en .env local
  const envPath = require('path').join(__dirname, '.env');
  const fs = require('fs');
  let envContent = '';
  if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('ANTHROPIC_API_KEY=')) {
    envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/g, `ANTHROPIC_API_KEY=${apiKey}`);
  } else {
    envContent += `\nANTHROPIC_API_KEY=${apiKey}`;
  }
  fs.writeFileSync(envPath, envContent.trim());
  process.env.ANTHROPIC_API_KEY = apiKey;
  res.json({ success: true });
});

// ── Campaigns ─────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns WHERE sessionId = ? ORDER BY createdAt DESC')
                 .all(req.query.sessionId || 'session-1');
  res.json({ success: true, data: rows });
});

app.post('/api/campaigns', (req, res) => {
  const { name, messages, dailyLimit, sessionId = 'session-1', nicheFilter, scheduledAt, targetIds,
          imageUrl, imageCaption, abMessages, sequenceId } = req.body;
  const id = uuidv4();

  let totalTargets = 0;
  if (Array.isArray(targetIds) && targetIds.length > 0) {
    totalTargets = targetIds.length;
  } else {
    try {
      const q = nicheFilter
        ? db.prepare("SELECT COUNT(*) as c FROM prospects WHERE sessionId = ? AND niche LIKE ? AND status = 'new'").get(sessionId, `%${nicheFilter}%`)
        : db.prepare("SELECT COUNT(*) as c FROM prospects WHERE sessionId = ? AND status = 'new'").get(sessionId);
      totalTargets = q.c;
    } catch {}
  }

  const initialStatus = scheduledAt ? 'scheduled' : 'draft';
  db.prepare(`
    INSERT INTO campaigns (id, name, messages, dailyLimit, sessionId, nicheFilter, totalTargets,
      scheduledAt, status, targetIds, imageUrl, imageCaption, abMessages, sequenceId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, JSON.stringify(messages), dailyLimit || 80, sessionId,
         nicheFilter || null, totalTargets, scheduledAt || null, initialStatus,
         targetIds ? JSON.stringify(targetIds) : null,
         imageUrl || null, imageCaption || null,
         abMessages ? JSON.stringify(abMessages) : null,
         sequenceId || null);

  if (scheduledAt) require('./modules/scheduler').scheduleOne(id, scheduledAt);
  res.json({ success: true, id });
});

app.post('/api/campaigns/:id/start', (req, res) => {
  try {
    require('./modules/campaignManager').startCampaign(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/campaigns/:id/pause', (req, res) => {
  try {
    require('./modules/campaignManager').pauseCampaign(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/campaigns/:id/schedule', (req, res) => {
  const { scheduledAt } = req.body;
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt requerido' });
  db.prepare("UPDATE campaigns SET scheduledAt = ?, status = 'scheduled' WHERE id = ?").run(scheduledAt, req.params.id);
  require('./modules/scheduler').scheduleOne(req.params.id, scheduledAt);
  res.json({ success: true });
});

app.delete('/api/campaigns/:id/schedule', (req, res) => {
  db.prepare("UPDATE campaigns SET scheduledAt = NULL, status = 'draft' WHERE id = ?").run(req.params.id);
  require('./modules/scheduler').cancelOne(req.params.id);
  res.json({ success: true });
});

// Clonar campaña
app.post('/api/campaigns/:id/clone', (req, res) => {
  const orig = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!orig) return res.status(404).json({ error: 'Campaña no encontrada' });
  const newId = uuidv4();
  db.prepare(`
    INSERT INTO campaigns (id, name, messages, dailyLimit, sessionId, nicheFilter, totalTargets,
      status, targetIds, imageUrl, imageCaption, abMessages, sequenceId)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(newId, `${orig.name} (copia)`, orig.messages, orig.dailyLimit, orig.sessionId,
         orig.nicheFilter, 0, orig.targetIds, orig.imageUrl, orig.imageCaption,
         orig.abMessages, orig.sequenceId);
  res.json({ success: true, id: newId });
});

app.delete('/api/campaigns/:id', (req, res) => {
  const { id } = req.params;
  const sid = req.query.sessionId || 'session-1';
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ? AND sessionId = ?').get(id, sid);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada' });
  try { require('./modules/campaignManager').pauseCampaign(id); } catch {}
  db.transaction(() => {
    db.prepare("UPDATE prospects SET status='new', lastCampaignId=NULL WHERE lastCampaignId=? AND status='queued'").run(id);
    db.prepare('DELETE FROM logs WHERE campaignId = ?').run(id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  })();
  res.json({ success: true });
});

app.post('/api/campaigns/:id/reset', (req, res) => {
  const { id } = req.params;
  const sid = req.query.sessionId || 'session-1';
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ? AND sessionId = ?').get(id, sid);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada' });
  try { require('./modules/campaignManager').pauseCampaign(id); } catch {}
  db.transaction(() => {
    db.prepare("UPDATE prospects SET status='new', lastCampaignId=NULL, lastContactedAt=NULL WHERE lastCampaignId=? AND status IN ('contacted','queued','failed')").run(id);
    db.prepare('DELETE FROM logs WHERE campaignId = ?').run(id);
    db.prepare("UPDATE campaigns SET status='draft', sent=0, failed=0, repliesCount=0, startedAt=NULL, completedAt=NULL, scheduledAt=NULL WHERE id=?").run(id);
  })();
  res.json({ success: true });
});

app.get('/api/campaigns/:id/logs', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const camp = db.prepare('SELECT id FROM campaigns WHERE id = ? AND sessionId = ?').get(req.params.id, sid);
  if (!camp) return res.json({ success: true, data: [] });
  const rows = db.prepare('SELECT * FROM logs WHERE campaignId = ? ORDER BY createdAt DESC LIMIT 200').all(req.params.id);
  res.json({ success: true, data: rows.reverse() });
});

// ── Replies / Inbox ───────────────────────────────────────────
app.get('/api/replies', (req, res) => {
  const { sessionId = 'session-1', page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const convos = db.prepare(`
    SELECT r.fromPhone,
           MAX(r.prospectName) as prospectName,
           MAX(r.timestamp) as lastTime,
           COUNT(*) as msgCount,
           SUM(CASE WHEN r.isRead = 0 THEN 1 ELSE 0 END) as unread,
           (SELECT message FROM replies WHERE fromPhone = r.fromPhone AND sessionId = r.sessionId ORDER BY timestamp DESC LIMIT 1) as lastMessage
    FROM replies r
    WHERE r.sessionId = ?
    GROUP BY r.fromPhone
    ORDER BY lastTime DESC
    LIMIT ? OFFSET ?
  `).all(sessionId, parseInt(limit), offset);
  const total = db.prepare('SELECT count(DISTINCT fromPhone) as c FROM replies WHERE sessionId = ?').get(sessionId).c;
  res.json({ success: true, data: convos, total });
});

app.get('/api/replies/:phone', (req, res) => {
  const { sessionId = 'session-1' } = req.query;
  const phone = decodeURIComponent(req.params.phone);
  const msgs = db.prepare(
    'SELECT * FROM replies WHERE sessionId = ? AND fromPhone = ? ORDER BY timestamp ASC'
  ).all(sessionId, phone);
  db.prepare('UPDATE replies SET isRead = 1 WHERE sessionId = ? AND fromPhone = ?').run(sessionId, phone);
  res.json({ success: true, data: msgs });
});

// ── Templates ─────────────────────────────────────────────────
app.get('/api/templates', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY createdAt DESC').all();
  res.json({ success: true, data: rows });
});

app.post('/api/templates', (req, res) => {
  const { name, messages } = req.body;
  if (!name?.trim() || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'name y messages son requeridos' });
  }
  const id = uuidv4();
  db.prepare('INSERT INTO templates (id, name, content) VALUES (?, ?, ?)').run(id, name.trim(), JSON.stringify(messages));
  res.json({ success: true, id });
});

app.put('/api/templates/:id', (req, res) => {
  const { name, messages } = req.body;
  if (!name?.trim() || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'name y messages son requeridos' });
  }
  db.prepare('UPDATE templates SET name = ?, content = ? WHERE id = ?').run(name.trim(), JSON.stringify(messages), req.params.id);
  res.json({ success: true });
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Analytics ─────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  try {
    const data = require('./modules/analyticsModule').getAnalytics(req.query.sessionId || 'session-1');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Activity feed reciente (para dashboard)
app.get('/api/analytics/activity', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const rows = db.prepare(`
    SELECT a.*, p.name as prospectName, p.niche
    FROM activities a
    LEFT JOIN prospects p ON a.prospectId = p.id
    WHERE a.sessionId = ?
    ORDER BY a.createdAt DESC
    LIMIT 20
  `).all(sid);
  res.json({ success: true, data: rows });
});

// Stats por stage (CRM funnel)
app.get('/api/analytics/stages', (req, res) => {
  const sid = req.query.sessionId || 'session-1';
  const rows = db.prepare(`
    SELECT stage, COUNT(*) as count
    FROM prospects WHERE sessionId = ?
    GROUP BY stage ORDER BY count DESC
  `).all(sid);
  res.json({ success: true, data: rows });
});

// ── Sessions ──────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT * FROM sessions ORDER BY createdAt ASC').all() });
});

app.post('/api/sessions', (req, res) => {
  const id = `session-${Date.now()}`;
  db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(id, req.body.name || 'Nuevo Espacio');
  require('./modules/whatsappManager').createClient(id);
  res.json({ success: true, id });
});

app.put('/api/sessions/:id', (req, res) => {
  const { name, antiBanBaseDelay, antiBanBatchSize, antiBanBatchPause, antiBanIntraDelay, activeSources } = req.body;
  const fields = [], vals = [];
  if (name !== undefined)              { fields.push('name = ?');              vals.push(name); }
  if (antiBanBaseDelay !== undefined)  { fields.push('antiBanBaseDelay = ?');  vals.push(antiBanBaseDelay); }
  if (antiBanBatchSize !== undefined)  { fields.push('antiBanBatchSize = ?');  vals.push(antiBanBatchSize); }
  if (antiBanBatchPause !== undefined) { fields.push('antiBanBatchPause = ?'); vals.push(antiBanBatchPause); }
  if (antiBanIntraDelay !== undefined) { fields.push('antiBanIntraDelay = ?'); vals.push(antiBanIntraDelay); }
  if (activeSources !== undefined)     { fields.push('activeSources = ?');     vals.push(activeSources); }
  if (!fields.length) return res.json({ success: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

app.post('/api/sessions/:id/wake', (req, res) => {
  require('./modules/whatsappManager').createClient(req.params.id);
  res.json({ success: true });
});

app.delete('/api/sessions/:id', async (req, res) => {
  const { id } = req.params;
  const waManager   = require('./modules/whatsappManager');
  const campManager = require('./modules/campaignManager');
  const running = db.prepare("SELECT id FROM campaigns WHERE sessionId = ? AND status = 'running'").all(id);
  for (const c of running) {
    try { campManager.pauseCampaign(c.id); } catch {}
  }
  await waManager.destroySession(id);
  db.transaction(() => {
    db.prepare('DELETE FROM prospects WHERE sessionId = ?').run(id);
    db.prepare('DELETE FROM logs WHERE campaignId IN (SELECT id FROM campaigns WHERE sessionId = ?)').run(id);
    db.prepare('DELETE FROM campaigns WHERE sessionId = ?').run(id);
    db.prepare('DELETE FROM replies WHERE sessionId = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  })();
  res.json({ success: true });
});

// ── Instagram ─────────────────────────────────────────────────
app.get('/api/settings/instagram', (req, res) => {
  const token  = db.prepare("SELECT value FROM settings WHERE key = 'instagram_access_token'").get()?.value;
  const userId = db.prepare("SELECT value FROM settings WHERE key = 'instagram_user_id'").get()?.value;
  res.json({ success: true, hasToken: !!token, hasUserId: !!userId, userId: userId || '' });
});

app.post('/api/settings/instagram', (req, res) => {
  const { accessToken, userId } = req.body;
  if (!accessToken || !userId) return res.status(400).json({ success: false, error: 'accessToken y userId son requeridos' });
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)');
  upsert.run('instagram_access_token', accessToken.trim());
  upsert.run('instagram_user_id', userId.trim());
  res.json({ success: true });
});

app.post('/api/settings/instagram/verify', async (req, res) => {
  try {
    const ig = require('./modules/instagramModule');
    const info = await ig.verifyCredentials();
    res.json({ success: true, account: info });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/search/instagram', async (req, res) => {
  const { niche, city, limit = 60, customHashtags = [], sessionId = 'session-1' } = req.body;
  if (!niche) return res.status(400).json({ success: false, error: 'niche es requerido' });

  // Stream de progreso via SSE no aplica aquí — emitir por socket
  const ig = require('./modules/instagramModule');

  try {
    const results = await ig.search({
      niche, city, limit: Math.min(limit, 200), customHashtags, sessionId,
      onProgress: (prog) => global.io?.emit(`search:progress:${sessionId}`, prog),
    });

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO prospects
        (id, name, phone, email, city, niche, hasWebsite, website, instagram, source, score, notes, sessionId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'instagram', ?, ?, ?)
    `);

    let imported = 0;
    db.transaction(() => {
      for (const p of results) {
        stmt.run(
          p.id, p.name, p.phone || '', p.email || '', p.city || '',
          p.niche || 'Negocio', p.hasWebsite ? 1 : 0,
          p.website || '', p.instagram || '',
          p.score || 50, p.notes || '', sessionId
        );
        imported++;
      }
    })();

    res.json({ success: true, found: results.length, imported });
  } catch (e) {
    console.error('[IG Search]', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔗 Client connected:', socket.id);
  const waManager = require('./modules/whatsappManager');
  const allSessions = db.prepare('SELECT id FROM sessions').all();
  for (const s of allSessions) {
    const st = waManager.sessions.get(s.id)?.status;
    if (st) socket.emit(`whatsapp:status:${s.id}`, st);
  }
  socket.on('disconnect', () => console.log('❌ Client disconnected:', socket.id));
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n🚀 Prospector AI v2.2 — http://localhost:${PORT}\n`);
  const waManager   = require('./modules/whatsappManager');
  const campManager = require('./modules/campaignManager');
  const scheduler   = require('./modules/scheduler');
  const seqManager  = require('./modules/sequenceManager');
  waManager.initializeAllSessions();
  setTimeout(() => {
    campManager.resumeActiveCampaigns();
    scheduler.initScheduler();
    seqManager.initSequenceManager();
  }, 5000);
});
