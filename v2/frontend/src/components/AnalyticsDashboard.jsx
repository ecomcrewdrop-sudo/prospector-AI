import { motion } from 'framer-motion';
import { BarChart2, TrendingUp, MessageCircle, Target, Star, Users, Download } from 'lucide-react';
import { clsx } from 'clsx';
import * as XLSX from 'xlsx';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Tooltip,
  XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer
} from 'recharts';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

const NICHE_COLORS   = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
const SOURCE_COLORS  = {
  google_maps:     '#3b82f6',
  paginas_amarillas: '#f59e0b',
  facebook:        '#8b5cf6',
  instagram:       '#ec4899',
  openstreetmap:   '#10b981',
  csv_import:      '#94a3b8',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-xl text-xs shadow-xl">
      <p className="font-bold text-slate-300 mb-1.5">{label}</p>
      {payload.map((e, i) => <p key={i} style={{ color: e.color }} className="font-semibold">{e.name}: {e.value}</p>)}
    </div>
  );
};

function StatCard({ label, value, icon: Icon, color, sub }) {
  return (
    <div className={clsx('glass-panel p-5 border-l-4', color)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
          <p className="text-3xl font-black text-white">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <Icon size={24} className="text-slate-600" />
      </div>
    </div>
  );
}

function exportToExcel(analytics, sessionId) {
  try {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Daily activity
    if (analytics.chartData?.length) {
      const ws1 = XLSX.utils.json_to_sheet(analytics.chartData.map(d => ({
        Fecha: d.date,
        Enviados: d.sent,
        Respuestas: d.replies,
      })));
      XLSX.utils.book_append_sheet(wb, ws1, 'Actividad 7 días');
    }

    // Sheet 2: Campaign stats
    if (analytics.campaignStats?.length) {
      const ws2 = XLSX.utils.json_to_sheet(analytics.campaignStats.map(c => ({
        Campaña: c.name,
        Estado: c.status,
        Enviados: c.sent,
        Fallidos: c.failed,
        Respuestas: c.repliesCount,
        Total: c.totalTargets,
      })));
      XLSX.utils.book_append_sheet(wb, ws2, 'Campañas');
    }

    // Sheet 3: Niches
    if (analytics.topNiches?.length) {
      const ws3 = XLSX.utils.json_to_sheet(analytics.topNiches.map(n => ({
        Nicho: n.niche,
        Prospectos: n.count,
      })));
      XLSX.utils.book_append_sheet(wb, ws3, 'Nichos');
    }

    // Sheet 4: Sources
    if (analytics.bySources?.length) {
      const ws4 = XLSX.utils.json_to_sheet(analytics.bySources.map(s => ({
        Fuente: s.source?.replace(/_/g, ' '),
        Prospectos: s.count,
      })));
      XLSX.utils.book_append_sheet(wb, ws4, 'Fuentes');
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `prospector-analytics-${dateStr}.xlsx`);
    toast.success('Excel exportado');
  } catch {
    toast.error('Error exportando Excel');
  }
}

export default function AnalyticsDashboard({ analytics, sessionId }) {
  if (!analytics) return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <div className="text-center">
        <BarChart2 size={40} className="mx-auto mb-2 opacity-20" />
        <p>Cargando analytics...</p>
      </div>
    </div>
  );

  const convRate = analytics.totalContacted > 0
    ? ((analytics.totalContacted / Math.max(analytics.totalProspects, 1)) * 100).toFixed(1)
    : 0;

  // Source performance chart data
  const sourceChartData = (analytics.bySources || []).map(s => ({
    name: s.source?.replace(/_/g, ' ') || '',
    prospectos: s.count,
    contactados: s.contacted || 0,
    respondieron: s.replied || 0,
  }));

  return (
    <motion.div key="analytics" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-7">

      {/* Header with export */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-white">Analytics</h2>
        <button
          onClick={() => exportToExcel(analytics, sessionId)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 rounded-xl text-sm font-bold transition-colors"
        >
          <Download size={14} /> Exportar Excel
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <StatCard label="Total Prospectos" value={analytics.totalProspects}  icon={Users}        color="border-l-blue-500"   sub={`${analytics.totalNew} nuevos`} />
        <StatCard label="Total Contactados" value={analytics.totalContacted} icon={Target}       color="border-l-green-500"  sub={`${convRate}% del total`} />
        <StatCard label="Total Respuestas"  value={analytics.totalReplied}   icon={MessageCircle} color="border-l-purple-500" sub={`${analytics.responseRate}% tasa`} />
        <StatCard label="Mejor Día"         value={analytics.bestDay}        icon={Star}         color="border-l-yellow-500" sub="Por volumen de envíos" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-7">

        {/* Activity chart */}
        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-sm font-bold text-white mb-5 flex items-center gap-2">
            <TrendingUp size={16} className="text-primary-400" /> Enviados vs Respuestas — 7 días
          </h3>
          {analytics.chartData?.some(d => d.sent > 0 || d.replies > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analytics.chartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Line type="monotone" dataKey="sent"    name="Enviados"   stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="replies" name="Respuestas" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm">Sin datos — inicia una campaña para ver métricas</div>
          )}
        </div>

        {/* Top niches pie */}
        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-sm font-bold text-white mb-5 flex items-center gap-2">
            <BarChart2 size={16} className="text-primary-400" /> Distribución por Nicho
          </h3>
          {analytics.topNiches?.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={analytics.topNiches} dataKey="count" nameKey="niche" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                    {analytics.topNiches.map((_, i) => <Cell key={i} fill={NICHE_COLORS[i % NICHE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {analytics.topNiches.map((n, i) => (
                  <div key={n.niche} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: NICHE_COLORS[i % NICHE_COLORS.length] }} />
                      <span className="text-xs text-slate-300 truncate">{n.niche}</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-400 shrink-0">{n.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-600 text-sm">Sin datos de nichos</div>
          )}
        </div>
      </div>

      {/* Source performance chart */}
      {sourceChartData.length > 0 && (
        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-sm font-bold text-white mb-5 flex items-center gap-2">
            <Users size={16} className="text-primary-400" /> Rendimiento por Fuente
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceChartData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={n => n.length > 10 ? n.slice(0, 10) + '…' : n} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Bar dataKey="prospectos"  name="Total"        fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="contactados" name="Contactados"  fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="respondieron" name="Respondieron" fill="#a855f7" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="space-y-2">
              {analytics.bySources.map(s => {
                const color = SOURCE_COLORS[s.source] || '#64748b';
                return (
                  <div key={s.source} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/40">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-xs text-slate-300 flex-1 capitalize">{s.source?.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-bold text-white">{s.count}</span>
                    {s.contacted > 0 && (
                      <span className="text-[10px] text-green-400">{((s.contacted / s.count) * 100).toFixed(0)}% contactado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Campaign comparison table */}
      {analytics.campaignStats?.length > 0 && (
        <div className="glass-panel p-6 bg-dark-800/30 space-y-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart2 size={16} className="text-primary-400" /> Comparativa de Campañas
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={analytics.campaignStats} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={n => n.length > 12 ? n.slice(0, 12) + '…' : n} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Bar dataKey="sent"         name="Enviados"   fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="repliesCount" name="Respuestas" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="failed"       name="Fallidos"   fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  {['Campaña', 'Estado', 'Enviados', 'Fallidos', 'Respuestas', 'Total', 'Tasa'].map(h => (
                    <th key={h} className="text-left pb-2 text-slate-500 font-bold uppercase tracking-wider pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analytics.campaignStats.map(c => {
                  const rate = c.sent > 0 ? ((c.repliesCount / c.sent) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={c.name} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                      <td className="py-2 pr-4 font-medium text-slate-200 max-w-[120px] truncate">{c.name}</td>
                      <td className="py-2 pr-4">
                        <span className={clsx('px-1.5 py-0.5 rounded text-[9px] font-black uppercase',
                          c.status === 'running' ? 'bg-green-500/20 text-green-400' :
                          c.status === 'completed' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-400'
                        )}>{c.status}</span>
                      </td>
                      <td className="py-2 pr-4 text-green-400 font-mono font-bold">{c.sent}</td>
                      <td className="py-2 pr-4 text-red-400 font-mono">{c.failed}</td>
                      <td className="py-2 pr-4 text-blue-400 font-mono">{c.repliesCount}</td>
                      <td className="py-2 pr-4 text-slate-400 font-mono">{c.totalTargets || '∞'}</td>
                      <td className="py-2 pr-4 text-violet-400 font-mono font-bold">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}
