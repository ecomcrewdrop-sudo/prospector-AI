'use strict';

const { sendText, checkNumber } = require('./whatsappManager');
const delay = ms => new Promise(r => setTimeout(r, ms));

function bellJitter(baseSec, spreadSec, multiplier = 1) {
  const u = () => Math.random();
  const norm = (u() + u() + u() + u() - 2) / 2;
  const ms = (baseSec + norm * spreadSec) * 1000 * multiplier;
  return delay(Math.max(ms, 800));
}

const activeJobs = new Map();

async function interruptibleDelay(totalMs, job) {
  const CHUNK = 3000;
  let remaining = totalMs;
  while (remaining > 0 && job.running) {
    await delay(Math.min(CHUNK, remaining));
    remaining -= CHUNK;
  }
}

// ── Logging ───────────────────────────────────────────────────
function saveLog(campaignId, type, msg, sessionId) {
  const time = new Date().toLocaleTimeString('es-CO');
  try {
    global.db.prepare('INSERT INTO logs (campaignId, time, type, msg) VALUES (?, ?, ?, ?)').run(campaignId, time, type, msg);
    global.io?.emit('campaign:log', { campaignId, time, type, msg, sessionId });
    const count = global.db.prepare('SELECT count(*) as c FROM logs WHERE campaignId = ?').get(campaignId)?.c || 0;
    if (count > 500) {
      global.db.prepare('DELETE FROM logs WHERE campaignId = ? AND id NOT IN (SELECT id FROM logs WHERE campaignId = ? ORDER BY id DESC LIMIT 500)').run(campaignId, campaignId);
    }
  } catch (err) {
    console.error('[saveLog]', err.message);
  }
}

// ── Spintax ───────────────────────────────────────────────────
function parseSpintax(text) {
  let result = text;
  for (let i = 0; i < 10; i++) {
    const prev = result;
    result = result.replace(/\{([^{}]+)\}/g, (_, opts) => {
      const choices = opts.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
    if (result === prev) break;
  }
  return result;
}

function buildMessages(campaign, prospect) {
  let rawMessages = [];
  try { rawMessages = JSON.parse(campaign.messages); } catch { rawMessages = [campaign.messages]; }

  if (campaign.abMessages) {
    try {
      const ab = JSON.parse(campaign.abMessages);
      if (Array.isArray(ab) && ab.length >= 2) {
        const idx = parseInt(prospect.id.slice(-1), 16) % 2;
        rawMessages = Array.isArray(ab[idx]) ? ab[idx] : [ab[idx]];
      }
    } catch {}
  }

  const rating = prospect.rating ? `⭐ ${prospect.rating}` : '';
  return rawMessages.map(m => parseSpintax(
    m.replace(/\{nombre\}/gi,      prospect.name      || 'amigo')
     .replace(/\{ciudad\}/gi,      prospect.city      || '')
     .replace(/\{categoria\}/gi,   prospect.niche     || 'negocio')
     .replace(/\{website\}/gi,     prospect.website   || '')
     .replace(/\{instagram\}/gi,   prospect.instagram || '')
     .replace(/\{calificacion\}/gi, rating)
     .replace(/\{score\}/gi,       String(prospect.score || ''))
     .replace(/\{email\}/gi,       prospect.email     || '')
     .replace(/\{direccion\}/gi,   prospect.address   || '')
  ));
}

function isBlacklisted(phone) {
  if (!phone) return false;
  const norm = String(phone).replace(/\D/g, '');
  try {
    return !!global.db.prepare('SELECT id FROM blacklist WHERE phone = ? OR phone = ? OR phone = ?')
      .get(norm, norm.slice(-9), norm.slice(-10));
  } catch { return false; }
}

function logActivity(prospectId, sessionId, type, data) {
  try {
    global.db.prepare('INSERT INTO activities (prospectId, sessionId, type, data) VALUES (?,?,?,?)')
      .run(prospectId, sessionId, type, JSON.stringify(data));
  } catch {}
}

function getStrategy(sessionId, campaignDailyLimit = 80) {
  try {
    const s = global.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return {
      baseDelay:   s?.antiBanBaseDelay  ?? 180,
      spread:      60,
      intraDelay:  s?.antiBanIntraDelay ?? 25,
      intraSpread: 8,
      batchSize:   s?.antiBanBatchSize  ?? 5,
      batchPause:  s?.antiBanBatchPause ?? 900,
      batchSpread: 240,
      dailyLimit:  campaignDailyLimit || 80,
    };
  } catch {
    return { baseDelay: 180, spread: 60, intraDelay: 25, intraSpread: 8, batchSize: 5, batchPause: 900, batchSpread: 240, dailyLimit: 80 };
  }
}

function countSentToday(sessionId) {
  try {
    return global.db.prepare(
      `SELECT count(*) as c FROM prospects WHERE sessionId = ? AND DATE(lastContactedAt, 'localtime') = DATE('now', 'localtime')`
    ).get(sessionId)?.c || 0;
  } catch { return 0; }
}

async function waitForWA(sessionId, job, maxMs = 15 * 60 * 1000) {
  const waManager = require('./whatsappManager');
  const POLL = 15000;
  let elapsed = 0;
  while (elapsed < maxMs && job.running) {
    if (waManager.sessions.get(sessionId)?.status?.connected) return true;
    if (elapsed === 0) console.log(`[CampaignManager] WA desconectado. Esperando...`);
    await delay(POLL);
    elapsed += POLL;
  }
  return false;
}

function classifyWAError(err) {
  const msg = err?.message?.toLowerCase() || '';
  if (msg.includes('no lid') || msg.includes('fatal wa md')) return 'fatal';
  if (msg.includes('rate') || msg.includes('too many') || msg.includes('429') || msg.includes('spam')) return 'ratelimit';
  return 'transient';
}

async function doSend(client, chatId, text, campaign) {
  if (campaign.imageUrl) {
    try {
      const { MessageMedia } = require('whatsapp-web.js');
      const pathLib = require('path');
      const fs = require('fs');
      const imgPath = pathLib.join(__dirname, '..', campaign.imageUrl.replace(/^\//, ''));
      if (fs.existsSync(imgPath)) {
        const media   = MessageMedia.fromFilePath(imgPath);
        const caption = campaign.imageCaption ? `${campaign.imageCaption}\n\n${text}` : text;
        return await client.sendMessage(chatId, media, { caption });
      }
    } catch (e) {
      console.warn('[doSend] Imagen no disponible:', e.message);
    }
  }
  return await client.sendMessage(chatId, text);
}

// ════════════════════════════════════════════════════════════
// ── MOTOR DE INTELIGENCIA ─────────────────────────────────
// ════════════════════════════════════════════════════════════

class CampaignIntelligence {
  constructor(campaignId, sessionId) {
    this.campaignId   = campaignId;
    this.sessionId    = sessionId;
    this.window       = [];      // últimas 40 operaciones
    this.sendTimes    = [];      // timestamps de envíos OK para throughput
    this.rateLimits   = [];      // timestamps de rate-limits (ventana 30min)
    this.consecutiveFails = 0;
    this.totalChecked     = 0;
    this.totalNoWa        = 0;
    this.totalBlacklisted = 0;
    this.delayMultiplier  = 1.0; // se ajusta automáticamente
    this.lastEmit         = 0;
    this.stuckTimer       = null;
    this.stuckSince       = null;
  }

  record(type) {
    // type: 'ok' | 'fail' | 'no_wa' | 'ratelimit' | 'blacklisted' | 'no_phone' | 'transient'
    const ts = Date.now();
    this.window.push({ type, ts });
    if (this.window.length > 40) this.window.shift();
    this.totalChecked++;

    if (type === 'ok') {
      this.consecutiveFails = 0;
      this.stuckSince = null;
      this.sendTimes.push(ts);
      if (this.sendTimes.length > 30) this.sendTimes.shift();
      // Recuperación gradual del multiplicador tras envío exitoso
      this.delayMultiplier = Math.max(1.0, this.delayMultiplier * 0.93);

    } else if (type === 'fail' || type === 'transient') {
      this.consecutiveFails++;
      if (!this.stuckSince) this.stuckSince = ts;

    } else if (type === 'no_wa') {
      this.totalNoWa++;
      this.consecutiveFails = 0; // no-WA no es "fallo" del motor

    } else if (type === 'ratelimit') {
      this.consecutiveFails = 0;
      const cutoff = ts - 30 * 60 * 1000;
      this.rateLimits = this.rateLimits.filter(t => t > cutoff);
      this.rateLimits.push(ts);
      // Penalización inmediata al multiplicador
      this.delayMultiplier = Math.min(4.0, this.delayMultiplier + 0.8);

    } else if (type === 'blacklisted') {
      this.totalBlacklisted++;
      this.consecutiveFails = 0;
    }
  }

  analyze(job) {
    const recent = this.window.slice(-20);
    const recentSends = recent.filter(e => ['ok', 'fail', 'transient'].includes(e.type));
    const fails  = recentSends.filter(e => e.type !== 'ok').length;
    const failRate = recentSends.length >= 5 ? fails / recentSends.length : 0;
    const noWaRate = this.totalChecked > 10 ? this.totalNoWa / this.totalChecked : 0;
    const throughput = this._calcThroughput();
    const bottlenecks = [];

    // ── 1. Fallos consecutivos ─────────────────────────────
    if (this.consecutiveFails >= 10) {
      bottlenecks.push({
        id: 'consecutive_fails_critical',
        severity: 'critical',
        icon: '🚨',
        msg: `${this.consecutiveFails} fallos consecutivos`,
        detail: 'El motor se detendrá automáticamente',
        action: 'auto_pause',
      });
    } else if (this.consecutiveFails >= 5) {
      bottlenecks.push({
        id: 'consecutive_fails',
        severity: 'warning',
        icon: '⚠️',
        msg: `${this.consecutiveFails} fallos seguidos`,
        detail: 'Aumentando delays preventivamente',
        action: 'increase_delay',
      });
      this.delayMultiplier = Math.min(4.0, Math.max(this.delayMultiplier, 2.0));
    }

    // ── 2. Tasa de fallos alta ─────────────────────────────
    if (failRate > 0.4 && recentSends.length >= 8) {
      bottlenecks.push({
        id: 'high_fail_rate',
        severity: failRate > 0.6 ? 'critical' : 'warning',
        icon: '📉',
        msg: `Tasa de fallo: ${(failRate * 100).toFixed(0)}%`,
        detail: `${fails} de ${recentSends.length} envíos recientes fallaron`,
        action: 'increase_delay',
      });
      this.delayMultiplier = Math.min(4.0, Math.max(this.delayMultiplier, failRate > 0.6 ? 2.5 : 1.8));
    }

    // ── 3. Rate limiting de WhatsApp ───────────────────────
    if (this.rateLimits.length >= 3) {
      bottlenecks.push({
        id: 'rate_limit_critical',
        severity: 'critical',
        icon: '🚫',
        msg: `Rate-limit de WA (${this.rateLimits.length} en 30min)`,
        detail: 'WhatsApp está bloqueando temporalmente el número',
        action: 'long_pause',
      });
      this.delayMultiplier = Math.min(4.0, Math.max(this.delayMultiplier, 3.5));
    } else if (this.rateLimits.length >= 1) {
      bottlenecks.push({
        id: 'rate_limit',
        severity: 'warning',
        icon: '⏳',
        msg: `Rate-limit detectado (${this.rateLimits.length} en 30min)`,
        detail: 'Delays aumentados para evitar bloqueo',
        action: 'increase_delay',
      });
    }

    // ── 4. Mala calidad de datos (muchos sin WA) ───────────
    if (noWaRate > 0.65 && this.totalChecked >= 15) {
      bottlenecks.push({
        id: 'bad_data',
        severity: 'warning',
        icon: '📋',
        msg: `${(noWaRate * 100).toFixed(0)}% sin WhatsApp`,
        detail: 'La base de datos tiene muchos números inválidos',
        action: null,
      });
    }

    // ── 5. Campaña atascada (0 envíos en 20+ minutos) ─────
    if (job.sent > 0 && this.stuckSince && (Date.now() - this.stuckSince) > 20 * 60 * 1000) {
      bottlenecks.push({
        id: 'stuck',
        severity: 'critical',
        icon: '🔒',
        msg: 'Campaña atascada',
        detail: 'Sin entregas en más de 20min — posible problema de conexión',
        action: 'investigate',
      });
    }

    return {
      bottlenecks,
      metrics: {
        consecutiveFails: this.consecutiveFails,
        failRate:         Math.round(failRate * 100),
        noWaRate:         Math.round(noWaRate * 100),
        throughput,       // msgs/hora real
        rateLimits:       this.rateLimits.length,
        delayMultiplier:  Math.round(this.delayMultiplier * 10) / 10,
        totalNoWa:        this.totalNoWa,
        totalBlacklisted: this.totalBlacklisted,
      },
    };
  }

  _calcThroughput() {
    if (this.sendTimes.length < 2) return 0;
    const span = (this.sendTimes.at(-1) - this.sendTimes[0]) / 1000;
    if (span < 30) return 0;
    return Math.round((this.sendTimes.length / span) * 3600);
  }

  emit(job, totalTargets, strategy) {
    const now = Date.now();
    if (now - this.lastEmit < 5000) return; // max 1 emit/5s
    this.lastEmit = now;

    const analysis = this.analyze(job);
    const eta = this._calcETA(job, totalTargets, strategy);

    global.io?.emit('campaign:intelligence', {
      campaignId: this.campaignId,
      sessionId:  this.sessionId,
      ...analysis,
      eta,
      sent:   job.sent,
      failed: job.failed,
    });

    return analysis;
  }

  _calcETA(job, totalTargets, strategy) {
    const remaining = Math.max(0, (totalTargets || 0) - job.sent);
    if (remaining === 0 || !strategy?.baseDelay) return null;
    const avgDelaySec = strategy.baseDelay * this.delayMultiplier;
    const secsLeft = remaining * avgDelaySec;
    const eta = new Date(Date.now() + secsLeft * 1000);
    return eta.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
}

// ── Enviar secuencia con retry ────────────────────────────────
async function sendSequence(messages, prospect, campaign, sessionId, job, intel) {
  const waManager = require('./whatsappManager');
  const phone  = String(prospect.phone || '').replace(/\D/g, '');
  const chatId = `${phone}@c.us`;

  for (let i = 0; i < messages.length; i++) {
    if (!job.running) return 'cancelled';

    for (let attempt = 1; attempt <= 3; attempt++) {
      const sess = waManager.sessions.get(sessionId);
      if (!sess?.status?.connected) {
        const reconnected = await waitForWA(sessionId, job);
        if (!reconnected) return 'wa_unavailable';
      }

      try {
        const sess2 = waManager.sessions.get(sessionId);
        if (i === 0 && campaign.imageUrl && sess2?.client) {
          await doSend(sess2.client, chatId, messages[i], campaign);
        } else {
          await sendText(prospect.phone, messages[i], sessionId);
        }
        break; // éxito
      } catch (err) {
        const kind = classifyWAError(err);
        if (kind === 'fatal') throw err;
        if (kind === 'ratelimit') {
          intel.record('ratelimit');
          const pauseMs = (5 + Math.random() * 7) * 60 * 1000;
          saveLog(campaign.id, 'warning', `⏳ Rate-limit WA — pausa ${(pauseMs / 60000).toFixed(0)}min`, sessionId);
          await interruptibleDelay(pauseMs, job);
          if (!job.running) return 'cancelled';
        }
        if (attempt === 3) throw err;
        await delay(attempt * 5000);
      }
    }

    if (i < messages.length - 1) {
      const S = getStrategy(sessionId, campaign.dailyLimit);
      await bellJitter(S.intraDelay, S.intraSpread, intel.delayMultiplier);
    }
  }
  return 'ok';
}

// ════════════════════════════════════════════════════════════
// ── MOTOR PRINCIPAL ───────────────────────────────────────
// ════════════════════════════════════════════════════════════

async function startCampaignJob(campaignId) {
  if (activeJobs.has(campaignId)) return;
  const db = global.db;

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign || campaign.status !== 'running') return;

  const sessionId = campaign.sessionId || 'session-1';
  const job   = { running: true, sent: campaign.sent || 0, failed: campaign.failed || 0 };
  const intel = new CampaignIntelligence(campaignId, sessionId);
  activeJobs.set(campaignId, job);

  saveLog(campaignId, 'info', `🚀 Motor iniciado — "${campaign.name}"`, sessionId);

  try {
    while (job.running) {
      const S = getStrategy(sessionId, campaign.dailyLimit);

      // ── Límite diario ───────────────────────────────────
      const sentToday = countSentToday(sessionId);
      if (sentToday >= S.dailyLimit) {
        const tomorrow = new Date();
        tomorrow.setHours(8, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        saveLog(campaignId, 'warning', `🛡️ Límite diario ${sentToday}/${S.dailyLimit}. Esperando hasta 08:00.`, sessionId);
        await interruptibleDelay(tomorrow - Date.now(), job);
        continue;
      }

      // ── Siguiente prospecto ─────────────────────────────
      const targetIds = campaign.targetIds ? (() => { try { return JSON.parse(campaign.targetIds); } catch { return null; } })() : null;
      let prospect;

      if (targetIds?.length > 0) {
        const ph = targetIds.map(() => '?').join(',');
        prospect = db.prepare(
          `SELECT * FROM prospects WHERE id IN (${ph}) AND (status='new' OR (status='queued' AND lastCampaignId=?)) AND sessionId=? LIMIT 1`
        ).get(...targetIds, campaignId, sessionId);
      } else {
        prospect = campaign.nicheFilter
          ? db.prepare(`SELECT * FROM prospects WHERE (status='new' OR (status='queued' AND lastCampaignId=?)) AND sessionId=? AND niche LIKE ? LIMIT 1`).get(campaignId, sessionId, `%${campaign.nicheFilter}%`)
          : db.prepare(`SELECT * FROM prospects WHERE (status='new' OR (status='queued' AND lastCampaignId=?)) AND sessionId=? LIMIT 1`).get(campaignId, sessionId);
      }

      if (!prospect) {
        saveLog(campaignId, 'success', `✅ Todos los prospectos procesados. Campaña finalizada.`, sessionId);
        db.prepare("UPDATE campaigns SET status='completed', completedAt=? WHERE id=?").run(new Date().toISOString(), campaignId);
        global.io?.emit('campaign:completed', { campaignId, sessionId });
        break;
      }

      // ── Saltar sin teléfono ─────────────────────────────
      if (!prospect.phone?.trim()) {
        intel.record('no_phone');
        db.prepare("UPDATE prospects SET status='failed', notes='Sin número' WHERE id=?").run(prospect.id);
        continue;
      }

      // ── Blacklist ───────────────────────────────────────
      if (isBlacklisted(prospect.phone)) {
        intel.record('blacklisted');
        db.prepare("UPDATE prospects SET status='failed', notes='Lista negra' WHERE id=?").run(prospect.id);
        saveLog(campaignId, 'warning', `🚫 ${prospect.name}: en lista negra`, sessionId);
        continue;
      }

      db.prepare("UPDATE prospects SET status='queued', lastCampaignId=? WHERE id=?").run(campaignId, prospect.id);

      // ── WA disponible ───────────────────────────────────
      const waReady = await waitForWA(sessionId, job, 15 * 60 * 1000);
      if (!waReady) {
        db.prepare("UPDATE prospects SET status='new' WHERE id=?").run(prospect.id);
        saveLog(campaignId, 'error', `❌ WA no disponible tras 15min. Motor suspendido.`, sessionId);
        db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
        break;
      }

      // ── Verificar número ────────────────────────────────
      let isWA = null;
      try {
        isWA = await Promise.race([
          checkNumber(prospect.phone, sessionId),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
        ]);
      } catch {
        isWA = null; // timeout → continuar sin verificar
      }

      if (isWA === false) {
        intel.record('no_wa');
        db.prepare("UPDATE prospects SET status='no_wa', notes='Sin WhatsApp' WHERE id=?").run(prospect.id);
        saveLog(campaignId, 'warning', `⚠️ ${prospect.name}: sin WhatsApp`, sessionId);

        // ── Análisis post no-WA ──────────────────────────
        const analysis = intel.emit(job, db.prepare('SELECT totalTargets FROM campaigns WHERE id=?').get(campaignId)?.totalTargets, S);
        if (analysis?.bottlenecks.some(b => b.id === 'bad_data')) {
          saveLog(campaignId, 'warning', `📋 Inteligencia: datos de baja calidad detectados — ${(analysis.metrics.noWaRate)}% sin WA`, sessionId);
        }
        continue;
      }

      // ── Enviar ──────────────────────────────────────────
      const messages = buildMessages(campaign, prospect);
      saveLog(campaignId, 'info', `✉️ Enviando a ${prospect.name}...`, sessionId);

      let sendResult = 'ok';
      try {
        sendResult = await sendSequence(messages, prospect, campaign, sessionId, job, intel);
      } catch (err) {
        const kind = classifyWAError(err);
        job.failed++;
        db.prepare("UPDATE campaigns SET failed=? WHERE id=?").run(job.failed, campaignId);

        if (kind === 'ratelimit') {
          intel.record('ratelimit');
          db.prepare("UPDATE prospects SET status='new' WHERE id=?").run(prospect.id);
          saveLog(campaignId, 'warning', `⏸ Rate-limit — ${prospect.name} devuelto a cola`, sessionId);
        } else {
          intel.record('fail');
          db.prepare("UPDATE prospects SET status='failed', notes=? WHERE id=?")
            .run(String(err.message || '').slice(0, 200), prospect.id);
          saveLog(campaignId, 'error', `❌ Error en ${prospect.name}: ${err.message}`, sessionId);
        }

        // ── Análisis de inteligencia post-fallo ──────────
        const totalTargets = db.prepare('SELECT totalTargets FROM campaigns WHERE id=?').get(campaignId)?.totalTargets;
        const analysis = intel.emit(job, totalTargets, S);

        if (analysis) {
          // Auto-pausa crítica
          if (analysis.bottlenecks.some(b => b.action === 'auto_pause')) {
            saveLog(campaignId, 'error', `🛑 Inteligencia: ${analysis.bottlenecks.find(b => b.action === 'auto_pause').msg} — motor detenido automáticamente`, sessionId);
            db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
            job.running = false;
            break;
          }
          // Logear bottlenecks nuevos
          for (const b of analysis.bottlenecks) {
            if (b.id !== 'bad_data') {
              saveLog(campaignId, 'warning', `${b.icon} Inteligencia [${b.severity}]: ${b.msg} — ${b.detail}`, sessionId);
            }
          }
        }

        global.io?.emit('campaign:progress', { campaignId, sent: job.sent, failed: job.failed, sessionId });
        await bellJitter(15, 5, intel.delayMultiplier);
        continue;
      }

      if (sendResult === 'cancelled') break;
      if (sendResult === 'wa_unavailable') {
        db.prepare("UPDATE prospects SET status='new' WHERE id=?").run(prospect.id);
        saveLog(campaignId, 'error', `❌ WA no disponible. Motor suspendido.`, sessionId);
        db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
        break;
      }

      // ── Éxito ───────────────────────────────────────────
      intel.record('ok');
      job.sent++;

      db.prepare("UPDATE prospects SET status='contacted', lastContactedAt=?, stage=CASE WHEN stage='new' THEN 'contacted' ELSE stage END WHERE id=?")
        .run(new Date().toISOString(), prospect.id);
      db.prepare("UPDATE campaigns SET sent=?, failed=? WHERE id=?").run(job.sent, job.failed, campaignId);

      logActivity(prospect.id, sessionId, 'message_sent', { campaignId, campaignName: campaign.name });
      saveLog(campaignId, 'success', `✅ Entregado a ${prospect.name} (×${intel.delayMultiplier.toFixed(1)} delay)`, sessionId);

      // Emitir progreso + inteligencia
      const totalTargets = db.prepare('SELECT totalTargets FROM campaigns WHERE id=?').get(campaignId)?.totalTargets;
      const analysis = intel.emit(job, totalTargets, S);
      const eta = analysis ? intel._calcETA(job, totalTargets, S) : null;
      global.io?.emit('campaign:progress', { campaignId, sent: job.sent, failed: job.failed, sessionId, eta });

      // Reportar si el multiplicador cambió significativamente
      if (intel.delayMultiplier > 1.3 && job.sent % 5 === 0) {
        saveLog(campaignId, 'info', `🧠 Inteligencia: delay ×${intel.delayMultiplier.toFixed(1)} — ajuste automático activo`, sessionId);
      }

      // ── Pausa Anti-Ban con multiplicador inteligente ────
      if (job.sent > 0 && job.sent % S.batchSize === 0) {
        const pauseSec = S.batchPause * intel.delayMultiplier + (Math.random() - 0.5) * 2 * S.batchSpread;
        saveLog(campaignId, 'warning', `🛡️ Anti-Ban: pausa de lote ${(pauseSec / 60).toFixed(1)}min`, sessionId);
        await interruptibleDelay(pauseSec * 1000, job);
      } else {
        await bellJitter(S.baseDelay, S.spread, intel.delayMultiplier);
      }
    }

  } finally {
    activeJobs.delete(campaignId);
    try {
      const current = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId);
      if (current?.status === 'running') {
        db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
        global.io?.emit('campaign:paused', { campaignId, sessionId });
      }
      db.prepare("UPDATE prospects SET status='new' WHERE status='queued' AND lastCampaignId=?").run(campaignId);
      db.prepare("UPDATE campaigns SET sent=?, failed=? WHERE id=?").run(job.sent, job.failed, campaignId);
    } catch (e) {
      console.error('[CampaignManager] Error en finally:', e.message);
    }
    saveLog(campaignId, 'warning', `⏸ Motor suspendido. (${job.sent} enviados / ${job.failed} fallidos)`, sessionId);
    global.io?.emit('campaign:intelligence', { campaignId, sessionId, stopped: true });
  }
}

// ── API pública ───────────────────────────────────────────────
function startCampaign(id) {
  const db   = global.db;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!camp) return;

  try {
    const targetIds = camp.targetIds ? JSON.parse(camp.targetIds) : null;
    let count = 0;
    if (targetIds?.length > 0) {
      const ph = targetIds.map(() => '?').join(',');
      count = db.prepare(`SELECT count(*) as c FROM prospects WHERE id IN (${ph}) AND (status='new' OR (status='queued' AND lastCampaignId=?)) AND sessionId=?`)
        .get(...targetIds, id, camp.sessionId)?.c || 0;
    } else {
      count = camp.nicheFilter
        ? db.prepare("SELECT count(*) as c FROM prospects WHERE sessionId=? AND niche LIKE ? AND (status='new' OR (status='queued' AND lastCampaignId=?))").get(camp.sessionId, `%${camp.nicheFilter}%`, id)?.c || 0
        : db.prepare("SELECT count(*) as c FROM prospects WHERE sessionId=? AND (status='new' OR (status='queued' AND lastCampaignId=?))").get(camp.sessionId, id)?.c || 0;
    }
    db.prepare("UPDATE campaigns SET totalTargets=? WHERE id=?").run(count + (camp.sent || 0), id);
  } catch (err) {
    console.error('[startCampaign] Error totalTargets:', err.message);
  }

  db.prepare("UPDATE campaigns SET status='running', startedAt=? WHERE id=?").run(new Date().toISOString(), id);
  startCampaignJob(id).catch(err => {
    console.error(`[CampaignManager] Error fatal en campaña ${id}:`, err.message);
    try { global.db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(id); } catch {}
    global.io?.emit('campaign:paused', { campaignId: id });
  });
}

function pauseCampaign(id) {
  global.db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(id);
  const job = activeJobs.get(id);
  if (job) job.running = false;
}

function resumeActiveCampaigns() {
  const running = global.db.prepare("SELECT id FROM campaigns WHERE status='running'").all();
  console.log(`♻️ [CampaignManager] Reanudando ${running.length} campañas activas...`);
  for (const c of running) {
    startCampaignJob(c.id).catch(err => {
      console.error(`[CampaignManager] Error reanudando ${c.id}:`, err.message);
      try { global.db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(c.id); } catch {}
    });
  }
}

module.exports = { startCampaign, pauseCampaign, resumeActiveCampaigns, activeJobs };
