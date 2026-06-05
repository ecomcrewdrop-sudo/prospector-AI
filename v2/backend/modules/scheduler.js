/**
 * Campaign Scheduler — Lanza campañas programadas a su hora exacta
 */

const pendingTimers = new Map(); // campaignId → timeoutId

function scheduleOne(campaignId, scheduledAt) {
  cancelOne(campaignId); // cancelar si ya había uno

  const target = new Date(scheduledAt).getTime();
  const now    = Date.now();
  const diff   = target - now;

  if (diff <= 0) {
    // Ya pasó la hora: lanzar inmediatamente si sigue siendo draft/scheduled
    _launchCampaign(campaignId);
    return;
  }

  console.log(`[Scheduler] 📅 Campaña ${campaignId} programada para ${new Date(target).toLocaleString('es-CO')} (en ${Math.round(diff / 60000)} min)`);

  // Usar intervals de 1 hora para evitar desbordamiento de setTimeout (max 2^31ms ≈ 24 días)
  const ONE_HOUR = 3600000;
  if (diff > ONE_HOUR) {
    const timerId = setTimeout(() => scheduleOne(campaignId, scheduledAt), ONE_HOUR);
    pendingTimers.set(campaignId, timerId);
  } else {
    const timerId = setTimeout(() => _launchCampaign(campaignId), diff);
    pendingTimers.set(campaignId, timerId);
  }
}

function cancelOne(campaignId) {
  if (pendingTimers.has(campaignId)) {
    clearTimeout(pendingTimers.get(campaignId));
    pendingTimers.delete(campaignId);
    console.log(`[Scheduler] ❌ Campaña ${campaignId} desprogramada`);
  }
}

async function _launchCampaign(campaignId) {
  pendingTimers.delete(campaignId);
  try {
    const db = global.db;
    const camp = db?.prepare('SELECT id, status, name FROM campaigns WHERE id = ?').get(campaignId);
    if (!camp) { console.warn(`[Scheduler] Campaña ${campaignId} no encontrada`); return; }
    if (!['draft', 'scheduled'].includes(camp.status)) {
      console.log(`[Scheduler] Campaña "${camp.name}" estado=${camp.status}, no se lanza`);
      return;
    }
    console.log(`[Scheduler] 🚀 Lanzando campaña programada: "${camp.name}"`);
    require('./campaignManager').startCampaign(campaignId);
  } catch (err) {
    console.error(`[Scheduler] Error lanzando ${campaignId}:`, err.message);
  }
}

// Al iniciar el servidor: cargar todas las campañas con scheduledAt futuro
function initScheduler() {
  const db = global.db;
  if (!db) return;

  const scheduled = db.prepare(`
    SELECT id, scheduledAt FROM campaigns
    WHERE status IN ('draft', 'scheduled') AND scheduledAt IS NOT NULL
  `).all();

  console.log(`[Scheduler] 📋 ${scheduled.length} campañas programadas encontradas`);

  for (const c of scheduled) {
    const target = new Date(c.scheduledAt).getTime();
    const now = Date.now();
    if (target <= now) {
      // La hora ya pasó: lanzar directamente
      console.log(`[Scheduler] ⏰ Campaña ${c.id} debió haber iniciado, lanzando ahora...`);
      _launchCampaign(c.id);
    } else {
      scheduleOne(c.id, c.scheduledAt);
    }
  }
}

module.exports = { scheduleOne, cancelOne, initScheduler };
