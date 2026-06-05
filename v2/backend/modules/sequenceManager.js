/**
 * Sequence Manager — Follow-up automático multi-paso post-campaña
 * Cada hora revisa prospectos contactados sin respuesta y envía el siguiente paso.
 */

const cron = require('node-cron');

let cronJob = null;

function initSequenceManager() {
  if (cronJob) return;
  // Revisar follow-ups cada hora
  cronJob = cron.schedule('0 * * * *', runFollowUps, { timezone: 'America/Bogota' });
  console.log('[SequenceManager] ✅ Iniciado — revisión cada hora');
}

async function runFollowUps() {
  const db = global.db;
  if (!db) return;

  console.log('[SequenceManager] 🔄 Revisando follow-ups pendientes...');

  // Campañas completadas con secuencia vinculada
  const campaigns = db.prepare(`
    SELECT c.*, s.steps as seqSteps
    FROM campaigns c
    JOIN sequences s ON c.sequenceId = s.id
    WHERE c.status IN ('completed', 'paused')
      AND c.sequenceId IS NOT NULL
      AND s.isActive = 1
  `).all();

  if (!campaigns.length) return;

  const waManager = require('./whatsappManager');

  for (const camp of campaigns) {
    let steps;
    try { steps = JSON.parse(camp.seqSteps); } catch { continue; }
    if (!steps?.length) continue;

    const sessionId = camp.sessionId || 'session-1';
    const waSession = waManager.sessions.get(sessionId);
    if (!waSession?.status.connected) continue;

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const delayDays = step.delayDays || (stepIdx + 1);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - delayDays);

      // Prospectos que: fueron contactados por esta campaña, no respondieron, no recibieron este paso
      const prospects = db.prepare(`
        SELECT p.* FROM prospects p
        WHERE p.lastCampaignId = ?
          AND p.status = 'contacted'
          AND p.sessionId = ?
          AND p.lastContactedAt <= ?
          AND NOT EXISTS (
            SELECT 1 FROM activities a
            WHERE a.prospectId = p.id
              AND a.type = 'followup_sent'
              AND json_extract(a.data, '$.stepIdx') = ?
              AND json_extract(a.data, '$.sequenceId') = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM replies r
            WHERE r.fromPhone LIKE '%' || substr(p.phone, -9)
              AND r.sessionId = p.sessionId
          )
        LIMIT 10
      `).all(camp.id, sessionId, cutoff.toISOString(), stepIdx, camp.sequenceId);

      for (const prospect of prospects) {
        try {
          const messages = Array.isArray(step.messages) ? step.messages : [step.messages];
          for (const msg of messages) {
            const text = parseSpintax(msg.replace(/\{nombre\}/g, prospect.name || 'amigo')
              .replace(/\{ciudad\}/g, prospect.city || '')
              .replace(/\{categoria\}/g, prospect.niche || ''));
            await waManager.sendText(prospect.phone, text, sessionId);
            await new Promise(r => setTimeout(r, 3000));
          }

          db.prepare(`INSERT INTO activities (prospectId, sessionId, type, data)
            VALUES (?, ?, 'followup_sent', ?)`).run(
            prospect.id, sessionId,
            JSON.stringify({ stepIdx, sequenceId: camp.sequenceId, campaignId: camp.id })
          );

          console.log(`[SequenceManager] ✉️ Follow-up paso ${stepIdx + 1} enviado a ${prospect.name}`);
        } catch (err) {
          console.error(`[SequenceManager] Error follow-up ${prospect.name}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

function parseSpintax(text) {
  return text.replace(/\{([^{}]+)\}/g, (_, options) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

// API pública
module.exports = {
  initSequenceManager,
  runFollowUps,
};
