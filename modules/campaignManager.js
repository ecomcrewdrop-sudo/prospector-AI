/**
 * CAMPAIGN MANAGER — Multi-Campaign Concurrent v3.0
 * ══════════════════════════════════════════════════
 * ✅ Múltiples campañas simultáneas sin bloqueos
 * ✅ Contador diario compartido pero thread-safe
 * ✅ Estado por campaña: running, paused, completed
 * ✅ Anti-ban: typing, delays, batch pause, horario laboral
 * ✅ Zero-crash: try/catch en toda operación crítica
 */

let ioRef = null;
let whatsappRef = null;
let accessors = null;

// Map de jobs activos: campaignId → job object
const activeJobs = new Map();

// ── Contador diario por sesión (Multi-número) ──────────────────
const dailyCounters = new Map();

function getDailyCounter(sessionId) {
  if (!dailyCounters.has(sessionId)) {
    dailyCounters.set(sessionId, {
      date: null,
      count: 0,
      reset() {
        const today = new Date().toDateString();
        if (this.date !== today) { this.date = today; this.count = 0; }
      },
      increment() { this.reset(); this.count++; },
      get() { this.reset(); return this.count; },
      remaining(limit) { return Math.max(0, limit - this.get()); }
    });
  }
  return dailyCounters.get(sessionId);
}

// ════════════════════════════════════════════════════════════
// ESTRATEGIA ANTI-BAN
// ════════════════════════════════════════════════════════════
const STRATEGY = {
  baseDelay: 180,       // 3 minutos base entre prospectos (antes 90)
  jitter: 120,          // + hasta 2 minutos extra (antes 60)
  intraDelay: 25,       // 25s entre mensajes al mismo prospecto (antes 18)
  intraJitter: 15,      // + 15s extra
  typingMin: 6,         // simulación de tipeo más larga
  typingMax: 15,
  batchSize: 5,         // pausa cada 5 mensajes (antes 8)
  batchPause: 900,      // 15 minutos de pausa por bloque (antes 600 = 10m)
  batchJitter: 300,     // + hasta 5 minutos extra en la pausa
  dailyLimit: 80,       // Límite conservador para evitar ban (antes 250)
  newAccountLimit: 20,
  workStart: 9,
  workEnd: 18,          // Terminar antes, horario más "humano" normal
  lunchStart: 12,
  lunchEnd: 14,
  respectHours: true,
  nightPause: true
};

const delay = ms => new Promise(r => setTimeout(r, ms));
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const humanDelay = (baseSec, jitterSec = 5) =>
  delay((baseSec + Math.random() * jitterSec) * 1000);

// ── Resetear campañas atascadas al arrancar ──────────────────
function resetStaleCampaigns(ac) {
  const campaigns = ac.getCampaigns();
  const prospects = ac.getProspects();
  let campaignsChanged = false;
  let prospectsChanged = false;

  campaigns.forEach(c => {
    if (c.status === 'running') {
      c.status = 'paused';
      campaignsChanged = true;
      console.log(`[Boot] Campaña "${c.name}" reseteada running→paused`);
    }
  });

  // Liberar prospectos atascados en 'queued' — si el servidor se reinició
  // en medio de una campaña, esos prospectos nunca recibirán mensaje
  prospects.forEach(p => {
    if (p.status === 'queued') {
      p.status = 'new';
      prospectsChanged = true;
    }
  });

  if (campaignsChanged) ac.saveCampaigns();
  if (prospectsChanged) {
    ac.saveProspects();
    console.log('[Boot] Prospectos atascados en queued → reseteados a new');
  }
}

function checkScheduledCampaigns() {
  if (!accessors) return;
  const campaigns = accessors.getCampaigns();
  const now = new Date();

  campaigns.forEach(c => {
    if (c.status === 'scheduled' && c.scheduledAt) {
      if (new Date(c.scheduledAt) <= now) {
        // Verificar que la sesión de ESTA campaña esté conectada
        const sessId = c.sessionId || 'session-1';
        const sessStatus = whatsappRef.getStatus(sessId);
        if (!sessStatus || !sessStatus.connected) return;
        console.log(`[Schedule] Iniciando campaña programada: ${c.name}`);
        startCampaign(c.id).catch(e => console.error('[Schedule Error]', e.message));
      }
    }
  });
}

function init(io, whatsappManager, dataAccessors) {
  ioRef = io;
  whatsappRef = whatsappManager;
  accessors = dataAccessors;
  resetStaleCampaigns(dataAccessors);

  // Iniciar chequeo de campañas programadas cada minuto
  setInterval(checkScheduledCampaigns, 60000);
}

// ════════════════════════════════════════════════════════════
// START — Permite múltiples campañas simultáneas
// ════════════════════════════════════════════════════════════
async function startCampaign(campaignId) {
  const campaigns = accessors.getCampaigns();
  const campIdx = campaigns.findIndex(c => c.id === campaignId);
  if (campIdx === -1) throw new Error('Campaña no encontrada');
  
  const campaign = campaigns[campIdx];
  const sessionId = campaign.sessionId || 'session-1'; // Default backward compatibility
  
  if (!whatsappRef.getStatus(sessionId).connected)
    throw new Error(`WhatsApp no está conectado en la línea asignada (${sessionId}). Escanea el código QR primero.`);
  if (activeJobs.has(campaignId))
    throw new Error('Esta campaña ya está en ejecución.');

  const prospects = accessors.getProspects();
  
  // Aislamiento Total: Solo prospectos de esta sesión (o sin sesión para retrocompatibilidad)
  const sessionProspects = prospects.filter(p => p.sessionId === sessionId || !p.sessionId);

  // Seleccionar prospectos objetivo — excluir queued, contacted y replied
  let targets = [];
  const SKIP_STATUSES = new Set(['contacted', 'replied', 'queued', 'converted']);
  if (campaign.prospectIds && campaign.prospectIds.length > 0) {
    targets = sessionProspects.filter(p =>
      campaign.prospectIds.includes(p.id) && !SKIP_STATUSES.has(p.status)
    );
  } else if (campaign.nicheFilter) {
    targets = sessionProspects.filter(p =>
      p.niche === campaign.nicheFilter && p.status === 'new'
    );
  } else {
    targets = sessionProspects.filter(p => p.status === 'new');
  }

  if (targets.length === 0)
    throw new Error('No hay prospectos disponibles (todos ya fueron contactados o la lista está vacía).');

  // Verificar límite diario ANTES de iniciar, POR SESIÓN
  const counter = getDailyCounter(sessionId);
  const dailyLimit = parseInt(campaign.dailyLimit) || STRATEGY.dailyLimit;
  const todaySent = counter.get();
  
  if (todaySent >= dailyLimit) {
    throw new Error(
      `⚠️ Límite diario alcanzado para la línea ${sessionId} (${todaySent}/${dailyLimit}). ` +
      `La campaña se reanudará automáticamente mañana a las ${STRATEGY.workStart}:00.`
    );
  }

  const remaining = dailyLimit - todaySent;
  const effective = targets.slice(0, remaining);

  // Marcar como running — NO marcar prospectos como queued aquí
  // (se marcan dentro de runCampaign justo antes de enviar, uno a uno)
  campaigns[campIdx].status = 'running';
  campaigns[campIdx].startedAt = new Date().toISOString();
  campaigns[campIdx].totalTargets = effective.length;
  campaigns[campIdx].sent = campaigns[campIdx].sent || 0;
  campaigns[campIdx].failed = campaigns[campIdx].failed || 0;
  accessors.saveCampaigns();

  if (ioRef) ioRef.emit('campaign:started', {
    campaignId, total: effective.length, name: campaign.name, sessionId
  });

  // Lanzar en background (NO blocking) → permite múltiples simultáneas
  setImmediate(() => runCampaign(campaignId, campaign, effective, dailyLimit, sessionId));

  return {
    success: true,
    message: `Campaña "${campaign.name}" iniciada → ${effective.length} prospectos en cola (límite hoy: ${dailyLimit})`
  };
}

// ════════════════════════════════════════════════════════════
// RUN (background, non-blocking por campaña)
// ════════════════════════════════════════════════════════════
async function runCampaign(campaignId, campaign, targets, dailyLimit, sessionId) {
  const job = { running: true, sent: 0, failed: 0, total: targets.length };
  activeJobs.set(campaignId, job);
  
  const counter = getDailyCounter(sessionId);

  const strategy = {
    baseDelay: parseInt(campaign.delayBetween) || STRATEGY.baseDelay,
    jitter: STRATEGY.jitter,
    intraDelay: parseInt(campaign.intraDelay) || STRATEGY.intraDelay,
    intraJitter: STRATEGY.intraJitter,
    typingMin: STRATEGY.typingMin,
    typingMax: STRATEGY.typingMax,
    batchSize: STRATEGY.batchSize,
    batchPause: STRATEGY.batchPause,
    batchJitter: STRATEGY.batchJitter,
    dailyLimit: dailyLimit || STRATEGY.dailyLimit,
    workStart: STRATEGY.workStart,
    workEnd: STRATEGY.workEnd,
    lunchStart: STRATEGY.lunchStart,
    lunchEnd: STRATEGY.lunchEnd,
    respectHours: campaign.schedule === 'business'
  };

  const msgList = Array.isArray(campaign.messages) && campaign.messages.length > 0
    ? campaign.messages
    : [campaign.message || ''];

  const hasImage = !!campaign.imageUrl;

  console.log(`▶ [Multi-Campaign v3] "${campaign.name}" — ${targets.length} prospectos · ${msgList.length} msg(s) (delay: ${strategy.baseDelay}s)`);
  emitLog(campaignId, 'info', `🚀 Campaña iniciada. Delay: ~${strategy.baseDelay}s entre prospectos.`);

  let consecutiveErrors = 0; // Para auto-pausar

  for (let i = 0; i < targets.length; i++) {
    // Verificar si se pausó externamente
    if (!job.running) break;

    // Re-verificar que el job sigue activo en el map
    if (!activeJobs.has(campaignId)) break;

    const prospect = targets[i];

    // ── 1. LÍMITE DIARIO POR SESIÓN ──────────────────────────────
    if (counter.get() >= strategy.dailyLimit) {
      const nextMorning = getNextWorkTime(strategy.workStart, strategy.workEnd);
      const waitMin = Math.round((nextMorning - Date.now()) / 60000);
      const reason = `📊 Límite diario alcanzado (${strategy.dailyLimit} msgs). Reanudando en ${waitMin} min`;
      console.log(`[Anti-Ban] "${campaign.name}" ${reason}`);
      emitLog(campaignId, 'warn', reason);
      await sleepUntilWithTicks(nextMorning, job, campaignId, 'Límite diario — esperando nuevo día');
      if (!job.running) break;
    }

    // ── 2. HORARIO LABORAL + ALMUERZO ────────────────────────
    if (strategy.respectHours) {
      await enforceWorkHours(strategy, job, campaignId);
      if (!job.running) break;
    }

    // ── 3. VALIDAR NÚMERO ────────────────────────────────────
    const phone = prospect.phone || prospect.whatsapp;
    if (!phone) {
      job.failed++;
      updateProspectInMemory(prospect.id, { status: 'new', notes: 'Sin número de teléfono' });
      emitLog(campaignId, 'skip', `⛔ ${prospect.name}: sin número`);
      continue;
    }

    // Marcar como en cola justo antes de enviar (atómico, uno a uno)
    updateProspectInMemory(prospect.id, { status: 'queued', lastCampaignId: campaignId });

    try {
    // ── 4. VERIFICAR WHATSAPP (con lógica de 3 estados) ────────────────────
    //   true  → tiene WA → enviar
    //   false → confirmado NO tiene WA → saltar (no marcar como error)
    //   null  → desconocido (error/timeout) → intentar enviar de todos modos
    const isRegistered = await whatsappRef.checkNumber(phone, sessionId);
    if (isRegistered === false) {
      // SOLO saltar si WA confirma definitivamente que no está registrado
      console.log(`[Skip] ⛔ ${prospect.name} (${phone}) → confirmado sin WhatsApp`);
      emitLog(campaignId, 'skip', `⛔ ${prospect.name} — confirmado sin WhatsApp`);
      job.failed++;
      // Solo anotar en notas, NO cambiar estado permanentemente
      updateProspectInMemory(prospect.id, { status: 'new', notes: 'Sin WhatsApp (confirmado por WA)' });
      await humanDelay(3, 2);
      continue;
    }
    if (isRegistered === null) {
      // Desconocido: error de red o WA inestable → intentar enviar igualmente
      console.warn(`[WA Check] ⚠️ ${prospect.name} (${phone}) → verificación falló, intentando enviar...`);
      emitLog(campaignId, 'warn', `⚠️ ${prospect.name}: verificación WA incierta, enviando de todas formas`);
    } else {
      // isRegistered === true
      console.log(`[WA Check] ✅ ${prospect.name} (${phone}) → tiene WhatsApp`);
    }

      // ── 5. SECUENCIA DE ENVÍO ────────────────────────────────
      if (hasImage) {
        await simulateTyping(phone, strategy, 0, sessionId);
        await whatsappRef.sendImage(phone, campaign.imageUrl, sessionId);
        console.log(`  📸 Imagen → ${prospect.name} [${campaign.name}]`);
        await humanDelay(rnd(strategy.intraDelay, strategy.intraDelay + 5), strategy.intraJitter);
      }

      for (let m = 0; m < msgList.length; m++) {
        if (!job.running) break;
        const rawMsg = msgList[m];
        if (!rawMsg?.trim()) continue;

        const message = addMicroVariation(personalizeMessage(rawMsg, prospect));
        await simulateTyping(phone, strategy, message.length, sessionId);
        await whatsappRef.sendTextOnly(phone, message, sessionId);

        console.log(`  💬 [${campaign.name}] Msg ${m + 1}/${msgList.length} → ${prospect.name}`);
        emitLog(campaignId, 'sent', `💬 ${prospect.name}: mensaje ${m + 1}/${msgList.length} enviado`);

        if (m < msgList.length - 1) {
          await humanDelay(strategy.intraDelay, strategy.intraJitter);
        }
      }

      // ── 6. ACTUALIZAR ESTADO ─────────────────────────────────
      job.sent++;
      counter.increment();

      updateProspectInMemory(prospect.id, {
        status: 'contacted',
        lastContactedAt: new Date().toISOString(),
        lastCampaignId: campaignId
      });
      updateCampaignInMemory(campaignId, { sent: job.sent });
      consecutiveErrors = 0; // Reiniciar en caso de éxito

      if (ioRef) ioRef.emit('campaign:progress', {
        campaignId,
        sent: job.sent,
        failed: job.failed,
        total: job.total,
        current: prospect.name,
        progress: Math.round(((i + 1) / targets.length) * 100)
      });

      console.log(`✓ [${i + 1}/${targets.length}] [${campaign.name}] ${prospect.name} — diario línea ${sessionId}: ${counter.get()}/${strategy.dailyLimit}`);

      // ── 7. PAUSA ENTRE PROSPECTOS / LOTE ─────────────────────
      if (job.sent > 0 && job.sent % strategy.batchSize === 0) {
        const pauseSec = strategy.batchPause + Math.random() * strategy.batchJitter;
        const msg = `⏸ [${campaign.name}] Pausa anti-ban: ${(pauseSec / 60).toFixed(1)} min (lote ${Math.floor(job.sent / strategy.batchSize)} completado)`;
        console.log(`[Anti-Ban] ${msg}`);
        emitLog(campaignId, 'pause', msg);
        if (ioRef) ioRef.emit('campaign:batch_pause', {
          campaignId, sent: job.sent,
          pauseSeconds: Math.round(pauseSec),
          reason: msg
        });
        await humanDelay(pauseSec, strategy.batchJitter);
      } else {
        const waitSec = strategy.baseDelay + Math.random() * strategy.jitter;
        emitLog(campaignId, 'wait', `⏳ Esperando ${waitSec.toFixed(0)}s antes del siguiente...`);
        await delay(waitSec * 1000);
      }

    } catch (err) {
      job.failed++;
      consecutiveErrors++;
      console.error(`✗ [${campaign.name}] Error con ${prospect.name}: ${err.message}`);
      emitLog(campaignId, 'error', `✗ ${prospect.name}: ${err.message}`);
      if (ioRef) ioRef.emit('campaign:error', { campaignId, prospect: prospect.name, error: err.message });

      if (consecutiveErrors >= 5) {
        const msg = `🚨 ALERTA CRÍTICA: 5 errores consecutivos. Campaña pausada por seguridad.`;
        console.error(`[ANTI-BAN EMERGENCIA] [${campaign.name}] ${msg}`);
        emitLog(campaignId, 'critical', msg);
        if (ioRef) ioRef.emit('campaign:sleeping', { campaignId, waitMinutes: 0, reason: msg });
        job.running = false;
        break; // Sale del loop principal
      }

      const isWAError = /ban|spam|restrict|blocked|403|rate/i.test(err.message);
      if (isWAError) {
        const emergencyPause = 600 + Math.random() * 600;
        const msg = `🚨 ALERTA: Posible restricción. Pausa de emergencia: ${(emergencyPause / 60).toFixed(0)} min`;
        console.error(`[ANTI-BAN EMERGENCIA] [${campaign.name}] ${msg}`);
        emitLog(campaignId, 'critical', msg);
        if (ioRef) ioRef.emit('campaign:sleeping', { campaignId, waitMinutes: Math.round(emergencyPause / 60), reason: msg });
        await delay(emergencyPause * 1000);
      } else {
        await humanDelay(15, 10);
      }
    }
  }

  // ── FIN DE CAMPAÑA ───────────────────────────────────────────
  const finalStatus = job.running ? 'completed' : 'paused';
  activeJobs.delete(campaignId);

  // Liberar cualquier prospecto que haya quedado en 'queued' sin enviar
  // (por ejemplo si se pausó antes de llegar a ellos)
  try {
    const allProspects = accessors.getProspects();
    let freedCount = 0;
    allProspects.forEach(p => {
      if (p.status === 'queued' && p.lastCampaignId === campaignId) {
        p.status = 'new';
        freedCount++;
      }
    });
    if (freedCount > 0) {
      accessors.saveProspects();
      console.log(`[${campaign.name}] Liberados ${freedCount} prospectos queued → new`);
    }
  } catch (e) { console.error('[cleanup queued]', e.message); }

  updateCampaignInMemory(campaignId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    sent: job.sent,
    failed: job.failed
  });

  if (ioRef) ioRef.emit('campaign:completed', {
    campaignId, sent: job.sent, failed: job.failed, total: job.total, status: finalStatus
  });
  console.log(`■ [${campaign.name}] ${finalStatus}. Enviados: ${job.sent} | Fallidos: ${job.failed}`);
  emitLog(campaignId, 'done', `✅ Campaña ${finalStatus}: ${job.sent} enviados, ${job.failed} fallidos`);
}

// ════════════════════════════════════════════════════════════
// ANTI-BAN HELPERS
// ════════════════════════════════════════════════════════════

async function simulateTyping(phone, strategy, textLength = 0, sessionId = 'session-1') {
  try {
    const chatId = phone.replace(/\D/g, '') + '@c.us';
    const client = whatsappRef.getClient(sessionId);
    const chat = client ? await client.getChatById(chatId).catch(() => null) : null;

    // Dynamic typing speed: approx 5 chars per second (0.2s per char)
    let typingSec = rnd(strategy.typingMin, strategy.typingMax);
    if (textLength > 0) {
      const calcSec = Math.round(textLength * 0.2);
      typingSec = Math.max(strategy.typingMin, Math.min(calcSec, strategy.typingMax * 1.5));
    }

    if (chat) {
      await chat.sendStateTyping();
      await delay(typingSec * 1000);
      await chat.clearState().catch(() => { });
    } else {
      await delay(typingSec * 1000);
    }
  } catch {
    await delay(rnd(4, 8) * 1000);
  }
}

function addMicroVariation(text) {
  const variations = [
    t => t,
    t => t + ' ',
    t => t.replace('. ', '.  '),
    t => t + '\u200B',
    t => t.replace(/!/g, match => Math.random() > 0.5 ? '!' : '!!'),
    t => t,
    t => t,
  ];
  return variations[Math.floor(Math.random() * variations.length)](text);
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function processSpintax(text) {
  let processed = text;
  const spintaxRegex = /\{([^{}]+)\}/g;
  processed = processed.replace(spintaxRegex, (match, contents) => {
    if (contents.includes('|')) {
      const options = contents.split('|');
      return options[Math.floor(Math.random() * options.length)].trim();
    }
    return match;
  });
  return processed;
}

function personalizeMessage(template, prospect) {
  const msgWithSpintax = processSpintax(template);
  const rawName = (prospect.name || '').trim();
  const firstName = capitalizeFirst(rawName.split(' ')[0]) || 'amigo';
  const negocio = rawName || 'su negocio';
  const nicho = (prospect.niche || '').toLowerCase() || 'su sector';
  const ciudad = capitalizeFirst(prospect.city || '') || 'su ciudad';

  return msgWithSpintax
    .replace(/\{nombre\}/gi, firstName)
    .replace(/\{negocio\}/gi, negocio)
    .replace(/\{nicho\}/gi, nicho)
    .replace(/\{ciudad\}/gi, ciudad);
}

async function enforceWorkHours(strategy, job, campaignId) {
  const checkAndWait = async () => {
    const now = new Date();
    const h = now.getHours();
    if (h < strategy.workStart || h >= strategy.workEnd) {
      const next = getNextWorkTime(strategy.workStart, strategy.workEnd);
      await sleepUntilWithTicks(next, job, campaignId,
        `Fuera de horario (${strategy.workStart}:00–${strategy.workEnd}:00)`);
      return;
    }
    if (h >= strategy.lunchStart && h < strategy.lunchEnd) {
      const lunchEnd = new Date();
      lunchEnd.setHours(strategy.lunchEnd, rnd(0, 15), 0, 0);
      await sleepUntilWithTicks(lunchEnd.getTime(), job, campaignId,
        `🥗 Pausa almuerzo (${strategy.lunchStart}:00–${strategy.lunchEnd}:00)`);
    }
  };
  await checkAndWait();
}

async function sleepUntilWithTicks(targetMs, job, campaignId, label = '') {
  const TICK = 30000;
  while (job.running && Date.now() < targetMs) {
    const waitMin = Math.round((targetMs - Date.now()) / 60000);
    const reason = label ? `⏰ ${label} — reanuda en ${waitMin} min` : `⏰ Esperando ${waitMin} min`;
    if (ioRef) ioRef.emit('campaign:sleeping', { campaignId, waitMinutes: waitMin, reason });
    await delay(Math.min(TICK, targetMs - Date.now()));
  }
}

function getNextWorkTime(workStart = STRATEGY.workStart, workEnd = STRATEGY.workEnd) {
  const now = new Date();
  const next = new Date(now);
  if (now.getHours() >= workEnd) next.setDate(next.getDate() + 1);
  next.setHours(workStart, rnd(0, 10), 0, 0);
  return next.getTime();
}

function emitLog(campaignId, level, message) {
  if (ioRef) ioRef.emit('campaign:log', { campaignId, level, message, ts: new Date().toISOString() });
}

// ════════════════════════════════════════════════════════════
// PAUSE / STOP
// ════════════════════════════════════════════════════════════
async function pauseCampaign(campaignId) {
  const job = activeJobs.get(campaignId);
  if (job) {
    job.running = false;
    activeJobs.delete(campaignId);
  }
  // Liberar prospectos en 'queued' asignados a esta campaña
  try {
    if (accessors) {
      const allProspects = accessors.getProspects();
      let freed = 0;
      allProspects.forEach(p => {
        if (p.status === 'queued' && p.lastCampaignId === campaignId) {
          p.status = 'new';
          freed++;
        }
      });
      if (freed > 0) { accessors.saveProspects(); console.log(`[Pause] Liberados ${freed} prospectos queued → new`); }
    }
  } catch (e) { console.error('[pause cleanup]', e.message); }
  updateCampaignInMemory(campaignId, { status: 'paused' });
  if (ioRef) ioRef.emit('campaign:paused', { campaignId });
}

async function stopAllCampaigns() {
  for (const [id, job] of activeJobs) {
    job.running = false;
    updateCampaignInMemory(id, { status: 'paused' });
  }
  activeJobs.clear();
}

function getActiveCampaigns() {
  return [...activeJobs.keys()];
}

function getDailyStats() {
  const stats = {
    limit: STRATEGY.dailyLimit,
    active: activeJobs.size,
    sessions: {}
  };
  
  let totalSent = 0;
  for (const [sessionId, counter] of dailyCounters.entries()) {
    const sent = counter.get();
    stats.sessions[sessionId] = { sent };
    totalSent += sent;
  }
  
  stats.sent = totalSent;
  return stats;
}

// ════════════════════════════════════════════════════════════
// DATA HELPERS
// ════════════════════════════════════════════════════════════
function updateProspectInMemory(id, updates) {
  try {
    const prospects = accessors.getProspects();
    const idx = prospects.findIndex(p => p.id === id);
    if (idx !== -1) { Object.assign(prospects[idx], updates); accessors.saveProspects(); }
  } catch (e) { console.error('[updateProspect]', e.message); }
}

function updateCampaignInMemory(id, updates) {
  try {
    const campaigns = accessors.getCampaigns();
    const idx = campaigns.findIndex(c => c.id === id);
    if (idx !== -1) {
      Object.assign(campaigns[idx], updates);
      accessors.saveCampaigns();
      if (ioRef) ioRef.emit('campaigns:updated');
    }
  } catch (e) { console.error('[updateCampaign]', e.message); }
}

module.exports = {
  init, startCampaign, pauseCampaign, stopAllCampaigns,
  getActiveCampaigns, getDailyStats
};
