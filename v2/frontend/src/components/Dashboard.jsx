import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Users, Send, MessageCircle, Zap, RefreshCw, Smartphone, CheckCircle2,
         Activity, TrendingUp, Trophy, Clock, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const STAGE_META = {
  new:         { label: 'Nuevo',      color: '#64748b' },
  contacted:   { label: 'Contactado', color: '#3b82f6' },
  replied:     { label: 'Respondió',  color: '#eab308' },
  interested:  { label: 'Interesado', color: '#f97316' },
  negotiating: { label: 'Negociando', color: '#a855f7' },
  won:         { label: 'Ganado',     color: '#22c55e' },
  lost:        { label: 'Perdido',    color: '#ef4444' },
};

const ACTIVITY_ICONS = {
  message_sent:   { icon: Send,           color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  reply:          { icon: MessageSquare,  color: 'text-green-400',  bg: 'bg-green-500/10' },
  stage_changed:  { icon: TrendingUp,     color: 'text-violet-400', bg: 'bg-violet-500/10' },
  note:           { icon: MessageCircle,  color: 'text-slate-400',  bg: 'bg-slate-500/10' },
  call:           { icon: Smartphone,     color: 'text-orange-400', bg: 'bg-orange-500/10' },
};

function KpiCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx('glass-panel p-7 border-t-2 hover:scale-[1.01] transition-transform group', color)}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{title}</p>
          <p className="text-5xl font-black text-white tracking-tighter">{value ?? 0}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1 font-medium">{subtitle}</p>}
        </div>
        <div className={clsx('p-3 rounded-2xl transition-all group-hover:scale-110', `bg-${color.split('-')[1]}-500/10`)}>
          <Icon size={28} className={clsx(`text-${color.split('-')[1]}-400`)} />
        </div>
      </div>
    </motion.div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel bg-slate-900/95 border border-slate-700 p-3 rounded-xl text-xs">
      <p className="font-bold text-slate-300 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }} className="font-semibold">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
};

// CRM Funnel visual
function CRMFunnel({ data }) {
  if (!data?.length) return (
    <div className="flex items-center justify-center h-32 text-slate-600 text-sm">Sin datos de pipeline</div>
  );

  const max = Math.max(...data.map(d => d.count), 1);

  return (
    <div className="space-y-2">
      {data.map(item => {
        const meta = STAGE_META[item.stage] || { label: item.stage, color: '#64748b' };
        const pct = Math.max((item.count / max) * 100, item.count > 0 ? 4 : 0);
        return (
          <div key={item.stage} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-24 shrink-0">{meta.label}</span>
            <div className="flex-1 h-5 bg-slate-800 rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg flex items-center px-2 transition-all"
                style={{ width: `${pct}%`, background: meta.color + '33', borderLeft: `2px solid ${meta.color}` }}
              >
                {item.count > 0 && (
                  <span className="text-[10px] font-bold" style={{ color: meta.color }}>{item.count}</span>
                )}
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500 w-6 text-right">{item.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// Activity feed
function ActivityFeed({ items }) {
  if (!items?.length) return (
    <div className="text-center py-6 text-slate-600 text-sm">Sin actividad reciente</div>
  );

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
      {items.map((item, i) => {
        const meta = ACTIVITY_ICONS[item.type] || ACTIVITY_ICONS.note;
        const Icon = meta.icon;
        let desc = '';
        try {
          const d = JSON.parse(item.data || '{}');
          if (item.type === 'message_sent') desc = `Mensaje enviado a ${item.prospectName || d.phone || ''}`;
          else if (item.type === 'stage_changed') desc = `${item.prospectName} → ${STAGE_META[d.to]?.label || d.to}`;
          else if (item.type === 'reply') desc = `Respondió: ${item.prospectName}`;
          else if (item.type === 'note') desc = `Nota en ${item.prospectName}`;
          else desc = item.type;
        } catch { desc = item.type; }

        const time = new Date(item.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        return (
          <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-800/30 transition-colors">
            <div className={clsx('p-1.5 rounded-lg shrink-0', meta.bg)}>
              <Icon size={11} className={meta.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 truncate">{desc}</p>
            </div>
            <span className="text-[10px] text-slate-600 shrink-0">{time}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({ stats, analytics, waStatus, campaigns, currentSessionId, onRefresh }) {
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length;
  const [funnelData, setFunnelData]     = useState([]);
  const [activityData, setActivityData] = useState([]);
  const [wonCount, setWonCount]         = useState(0);

  useEffect(() => {
    if (!currentSessionId) return;
    api.getAnalyticsStages(currentSessionId).then(r => {
      if (r.success) {
        setFunnelData(r.data);
        const won = r.data.find(d => d.stage === 'won');
        setWonCount(won?.count || 0);
      }
    });
    api.getAnalyticsActivity(currentSessionId).then(r => {
      if (r.success) setActivityData(r.data);
    });
  }, [currentSessionId]);

  const handleResetWA = async () => {
    const tid = toast.loading('Reiniciando motor WA...');
    try {
      await api.resetWA(currentSessionId);
      toast.dismiss(tid);
      toast.success('Motor WA reiniciado');
      onRefresh();
    } catch {
      toast.dismiss(tid);
      toast.error('Error al reiniciar motor WA');
    }
  };

  return (
    <motion.div key="dashboard" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-8">

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard title="Prospectos Activos" value={stats?.activeProspects} icon={Users}       color="border-t-blue-500"   subtitle="Listos para contactar" />
        <KpiCard title="Enviados Hoy"       value={analytics?.sentToday}   icon={Send}        color="border-t-purple-500" subtitle="Mensajes del día" />
        <KpiCard title="Tasa de Respuesta"  value={`${analytics?.responseRate ?? 0}%`} icon={TrendingUp} color="border-t-green-500" subtitle="De contactados" />
        <KpiCard title="Ganados"            value={wonCount}               icon={Trophy}      color="border-t-yellow-500" subtitle="Conversiones CRM" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-7">

        {/* Chart */}
        <div className="xl:col-span-2 glass-panel p-7 bg-dark-800/30">
          <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
            <Activity size={18} className="text-primary-400" /> Actividad — Últimos 7 días
          </h3>
          {analytics?.chartData?.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analytics.chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Line type="monotone" dataKey="sent"    name="Enviados"   stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="replies" name="Respuestas" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-600">
              <div className="text-center">
                <Activity size={40} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin datos aún. Inicia una campaña.</p>
              </div>
            </div>
          )}
        </div>

        {/* WhatsApp Panel */}
        <div className="glass-panel p-6 flex flex-col items-center justify-center relative overflow-hidden group bg-gradient-to-br from-dark-900 to-dark-800 border border-slate-700/50">
          <div className="absolute inset-0 bg-primary-500/3 opacity-0 group-hover:opacity-100 transition-opacity" />
          {!waStatus?.connected && waStatus?.qr ? (
            <div className="flex flex-col items-center z-10">
              <div className="bg-white p-3 rounded-2xl shadow-[0_0_30px_rgba(255,255,255,0.08)] relative group-hover:scale-105 transition-transform">
                <img src={waStatus.qr} alt="QR" className="w-36 h-36" />
                <div className="absolute inset-0 border-2 border-primary-500/40 rounded-2xl animate-pulse pointer-events-none" />
              </div>
              <p className="mt-4 text-sm font-bold text-slate-300">Escanea para enlazar</p>
              <p className="text-xs text-slate-500 mt-1">WhatsApp → Dispositivos → Vincular</p>
              <button onClick={handleResetWA} className="mt-3 text-[10px] text-slate-500 hover:text-red-400 uppercase font-bold tracking-widest transition-colors flex items-center gap-1">
                <RefreshCw size={9} /> Forzar reinicio
              </button>
            </div>
          ) : waStatus?.connected ? (
            <div className="flex flex-col items-center z-10 text-center">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4 border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.08)] relative">
                <Smartphone className="text-green-400 relative z-10" size={38} />
                <div className="absolute inset-0 rounded-full bg-green-400/10 animate-ping" />
              </div>
              <h3 className="text-green-400 font-black text-xl">ENLAZADO</h3>
              <p className="text-slate-400 text-sm mt-1 font-medium">+{waStatus.phone}</p>
              <p className="text-slate-500 text-xs mt-0.5">{waStatus.name}</p>
              <button onClick={handleResetWA} className="mt-5 text-[10px] text-slate-500 hover:text-red-400 uppercase font-bold tracking-widest transition-colors flex items-center gap-1">
                <RefreshCw size={9} /> Desvincular motor
              </button>
            </div>
          ) : waStatus?.state === 'FAILED' ? (
            <div className="flex flex-col items-center z-10 text-center">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-3 border border-red-500/20">
                <Smartphone className="text-red-400" size={32} />
              </div>
              <h3 className="text-red-400 font-bold">ERROR DE MOTOR</h3>
              <p className="text-slate-500 text-xs mt-1">Requiere intervención manual</p>
              <button onClick={handleResetWA} className="mt-4 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500/30 transition-colors">
                Reiniciar Motor
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center z-10">
              <Activity className="text-primary-500 animate-spin mb-3" size={38} />
              <p className="text-slate-300 font-semibold text-sm">Iniciando Motor WA...</p>
              <p className="text-slate-500 text-xs mt-1">{waStatus?.state || 'INITIALIZING'}</p>
              <button onClick={handleResetWA} className="mt-4 text-[10px] text-slate-500 hover:text-red-400 uppercase font-bold tracking-widest transition-colors flex items-center gap-1">
                <RefreshCw size={9} /> Forzar reinicio
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Funnel CRM + Activity Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-7">
        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-base font-bold text-white mb-5 flex items-center gap-2">
            <TrendingUp size={18} className="text-violet-400" /> Pipeline CRM
          </h3>
          <CRMFunnel data={funnelData} />
        </div>

        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <Clock size={18} className="text-green-400" /> Actividad Reciente
          </h3>
          <ActivityFeed items={activityData} />
        </div>
      </div>

      {/* Recent Campaigns */}
      {campaigns.length > 0 && (
        <div className="glass-panel p-6 bg-dark-800/30">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <Zap size={18} className="text-primary-400" /> Campañas Recientes
          </h3>
          <div className="space-y-3">
            {campaigns.slice(0, 4).map(c => {
              const pct = c.totalTargets > 0 ? Math.round((c.sent / c.totalTargets) * 100) : 0;
              return (
                <div key={c.id} className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-800/30 hover:bg-slate-800/50 transition-colors border border-transparent hover:border-slate-700/50">
                  <div className={clsx('w-2 h-10 rounded-full shrink-0', c.status === 'running' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : c.status === 'completed' ? 'bg-blue-500' : 'bg-slate-600')} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-200 truncate">{c.name}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary-600 to-blue-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">{c.sent}/{c.totalTargets || '∞'}</span>
                    </div>
                  </div>
                  <span className={clsx('text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider shrink-0',
                    c.status === 'running'   ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                    c.status === 'completed' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                    c.status === 'scheduled' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                    'bg-slate-700/80 text-slate-400 border border-slate-700'
                  )}>
                    {c.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
