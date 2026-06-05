/**
 * Analytics Module — Calcula métricas para el dashboard
 */

function getAnalytics(sessionId) {
  const db = global.db;
  if (!db) return getEmptyAnalytics();

  // ── Últimos 7 días de actividad ──────────────────────────────
  const sentPerDay = db.prepare(`
    SELECT DATE(lastContactedAt, 'localtime') as date, COUNT(*) as count
    FROM prospects
    WHERE sessionId = ? AND status = 'contacted'
      AND lastContactedAt >= DATE('now', '-7 days', 'localtime')
    GROUP BY DATE(lastContactedAt, 'localtime')
    ORDER BY date ASC
  `).all(sessionId);

  const repliesPerDay = db.prepare(`
    SELECT DATE(timestamp, 'localtime') as date, COUNT(*) as count
    FROM replies
    WHERE sessionId = ?
      AND timestamp >= DATE('now', '-7 days', 'localtime')
    GROUP BY DATE(timestamp, 'localtime')
    ORDER BY date ASC
  `).all(sessionId);

  // Rellenar días sin datos para que el gráfico sea continuo
  const chartData = fillMissingDays(sentPerDay, repliesPerDay, 7);

  // ── Totales ──────────────────────────────────────────────────
  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalProspects,
      SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as totalContacted,
      SUM(CASE WHEN status = 'no_wa' THEN 1 ELSE 0 END) as totalNoWA,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as totalNew,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as totalFailed
    FROM prospects WHERE sessionId = ?
  `).get(sessionId);

  const totalReplied = db.prepare(
    'SELECT COUNT(DISTINCT fromPhone) as c FROM replies WHERE sessionId = ?'
  ).get(sessionId)?.c || 0;

  const sentToday = db.prepare(`
    SELECT COUNT(*) as c FROM prospects
    WHERE sessionId = ? AND status = 'contacted'
      AND DATE(lastContactedAt, 'localtime') = DATE('now', 'localtime')
  `).get(sessionId)?.c || 0;

  // ── Tasa de respuesta ────────────────────────────────────────
  const responseRate = totals.totalContacted > 0
    ? Math.round((totalReplied / totals.totalContacted) * 100 * 10) / 10
    : 0;

  // ── Top Nichos ───────────────────────────────────────────────
  const topNiches = db.prepare(`
    SELECT niche, COUNT(*) as count
    FROM prospects WHERE sessionId = ? AND niche IS NOT NULL
    GROUP BY niche ORDER BY count DESC LIMIT 6
  `).all(sessionId);

  // ── Stats de campañas ────────────────────────────────────────
  const campaignStats = db.prepare(`
    SELECT c.name, c.sent, c.failed, c.repliesCount,
           c.totalTargets, c.status, c.createdAt,
           CASE WHEN c.sent > 0 THEN ROUND(CAST(c.repliesCount AS FLOAT) / c.sent * 100, 1) ELSE 0 END as replyRate
    FROM campaigns c
    WHERE c.sessionId = ?
    ORDER BY c.createdAt DESC LIMIT 10
  `).all(sessionId);

  // ── Mejor día de la semana (por envíos) ─────────────────────
  const byWeekday = db.prepare(`
    SELECT strftime('%w', lastContactedAt, 'localtime') as dow, COUNT(*) as count
    FROM prospects WHERE sessionId = ? AND status = 'contacted'
    GROUP BY dow ORDER BY count DESC LIMIT 1
  `).get(sessionId);

  const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const bestDay = byWeekday ? weekdays[parseInt(byWeekday.dow)] : 'Sin datos';

  // ── Fuentes de prospectos ────────────────────────────────────
  const bySources = db.prepare(`
    SELECT source, COUNT(*) as count FROM prospects
    WHERE sessionId = ? GROUP BY source ORDER BY count DESC
  `).all(sessionId);

  return {
    chartData,
    sentToday,
    totalProspects:   totals.totalProspects || 0,
    totalContacted:   totals.totalContacted || 0,
    totalNew:         totals.totalNew || 0,
    totalNoWA:        totals.totalNoWA || 0,
    totalFailed:      totals.totalFailed || 0,
    totalReplied,
    responseRate,
    topNiches,
    campaignStats,
    bestDay,
    bySources,
  };
}

function fillMissingDays(sent, replies, days) {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    // Use local date components so they match DATE(...,'localtime') in SQLite
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const s = sent.find(r => r.date === dateStr)?.count || 0;
    const r = replies.find(r => r.date === dateStr)?.count || 0;
    result.push({ date: dateStr, sent: s, replies: r });
  }
  return result;
}

function getEmptyAnalytics() {
  return {
    chartData: [], sentToday: 0,
    totalProspects: 0, totalContacted: 0, totalNew: 0, totalNoWA: 0, totalFailed: 0,
    totalReplied: 0, responseRate: 0,
    topNiches: [], campaignStats: [],
    bestDay: 'Sin datos', bySources: [],
  };
}

module.exports = { getAnalytics };
