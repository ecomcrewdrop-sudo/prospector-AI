import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Play, Pause, CheckCircle2, XCircle, Calendar, X, Trash2, RotateCcw,
         ChevronDown, ChevronUp, Copy, GitBranch, SplitSquareHorizontal,
         MessageSquare, Clock, WifiOff, Brain, TrendingUp, TrendingDown,
         AlertTriangle, AlertCircle, Info, Gauge } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import socket from '../lib/socket';
import toast from 'react-hot-toast';

// ── Status badge ──────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    running:   { cls: 'bg-primary-500/20 text-primary-300 border-primary-500/40', dot: true  },
    paused:    { cls: 'bg-slate-700/80 text-slate-400 border-slate-700',           dot: false },
    completed: { cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',           dot: false },
    draft:     { cls: 'bg-slate-700/80 text-slate-400 border-slate-700',           dot: false },
    scheduled: { cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30',     dot: false },
  };
  const c = cfg[status] || cfg.draft;
  return (
    <span className={clsx('flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md font-black uppercase tracking-widest border', c.cls)}>
      {c.dot && <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-ping" />}
      {status}
    </span>
  );
}

// ── Mini funnel ───────────────────────────────────────────────
function MiniFunnel({ sent, replies, interested = 0 }) {
  const max = Math.max(sent, 1);
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Embudo</p>
      {[
        { label: 'Enviados',     value: sent,       color: 'bg-blue-500' },
        { label: 'Respondieron', value: replies,    color: 'bg-yellow-500' },
        { label: 'Interesados',  value: interested, color: 'bg-green-500' },
      ].map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500 w-20 shrink-0">{s.label}</span>
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${s.color}`}
                 style={{ width: `${Math.min((s.value / max) * 100, 100)}%` }} />
          </div>
          <span className="text-[9px] font-mono text-slate-400 w-6 text-right">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Consola con auto-scroll ───────────────────────────────────
function LiveConsole({ logs }) {
  const bottomRef    = useRef(null);
  const containerRef = useRef(null);
  const [userScrolled, setUserScrolled] = useState(false);

  useEffect(() => {
    if (!userScrolled) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, userScrolled]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setUserScrolled(el.scrollHeight - el.scrollTop - el.clientHeight > 20);
  }, []);

  return (
    <div ref={containerRef} onScroll={handleScroll}
      className="h-32 bg-black/50 rounded-xl border border-slate-800/80 p-2 overflow-y-auto font-mono text-[10px] flex flex-col gap-0.5 custom-scrollbar">
      {logs.length === 0
        ? <span className="text-slate-600 p-1 italic">&gt; Sin logs aún...</span>
        : logs.slice(-80).map((log, i) => (
          <div key={i} className="flex gap-2 p-0.5 rounded hover:bg-white/5">
            <span className="text-slate-600 shrink-0">[{log.time}]</span>
            <span className={clsx('break-words leading-relaxed',
              log.type === 'error'   ? 'text-red-400' :
              log.type === 'success' ? 'text-green-400' :
              log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'
            )}>{log.msg}</span>
          </div>
        ))
      }
      <div ref={bottomRef} />
    </div>
  );
}

// ── Panel de inteligencia ─────────────────────────────────────
const SEVERITY_CFG = {
  critical: { cls: 'bg-red-500/10 border-red-500/30 text-red-400',    icon: AlertCircle },
  warning:  { cls: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', icon: AlertTriangle },
  info:     { cls: 'bg-blue-500/10 border-blue-500/30 text-blue-400', icon: Info },
};

function IntelligencePanel({ intel }) {
  if (!intel) return null;
  const { bottlenecks = [], metrics = {}, eta } = intel;
  const hasAlert = bottlenecks.length > 0;
  const worstSeverity = bottlenecks.find(b => b.severity === 'critical') ? 'critical'
                      : bottlenecks.find(b => b.severity === 'warning')  ? 'warning'
                      : null;

  return (
    <div className={clsx(
      'rounded-xl border p-3 space-y-2.5 transition-all',
      worstSeverity === 'critical' ? 'bg-red-500/5 border-red-500/20' :
      worstSeverity === 'warning'  ? 'bg-yellow-500/5 border-yellow-500/20' :
      'bg-slate-800/30 border-slate-700/40'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain size={12} className={clsx(
            worstSeverity === 'critical' ? 'text-red-400 animate-pulse' :
            worstSeverity === 'warning'  ? 'text-yellow-400' : 'text-primary-400'
          )} />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Inteligencia</span>
        </div>
        <div className="flex items-center gap-2">
          {metrics.delayMultiplier > 1 && (
            <span className={clsx(
              'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border',
              metrics.delayMultiplier >= 2.5 ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              metrics.delayMultiplier >= 1.5 ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
              'bg-slate-700 border-slate-600 text-slate-400'
            )}>
              ×{metrics.delayMultiplier} delay
            </span>
          )}
          {eta && (
            <span className="text-[9px] font-mono text-slate-500 flex items-center gap-0.5">
              <Clock size={8} /> ETA {eta}
            </span>
          )}
        </div>
      </div>

      {/* Métricas en tiempo real */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          {
            label: 'Éxito',
            value: metrics.failRate != null ? `${100 - metrics.failRate}%` : '—',
            color: (100 - (metrics.failRate||0)) >= 80 ? 'text-green-400' : (100 - (metrics.failRate||0)) >= 60 ? 'text-yellow-400' : 'text-red-400',
          },
          {
            label: 'Sin WA',
            value: metrics.noWaRate != null ? `${metrics.noWaRate}%` : '—',
            color: (metrics.noWaRate||0) < 30 ? 'text-slate-400' : (metrics.noWaRate||0) < 60 ? 'text-yellow-400' : 'text-red-400',
          },
          {
            label: 'Vel.',
            value: metrics.throughput ? `${metrics.throughput}/h` : '—',
            color: 'text-blue-400',
          },
          {
            label: 'Fallos',
            value: metrics.consecutiveFails != null ? String(metrics.consecutiveFails) : '—',
            color: (metrics.consecutiveFails||0) === 0 ? 'text-green-400' : (metrics.consecutiveFails||0) < 5 ? 'text-yellow-400' : 'text-red-400',
          },
        ].map(m => (
          <div key={m.label} className="text-center bg-black/20 rounded-lg py-1.5 px-1">
            <p className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">{m.label}</p>
            <p className={clsx('text-[11px] font-black font-mono', m.color)}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Alertas activas */}
      <AnimatePresence>
        {bottlenecks.map(b => {
          const cfg = SEVERITY_CFG[b.severity] || SEVERITY_CFG.info;
          return (
            <motion.div key={b.id}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className={clsx('flex items-start gap-2 px-2.5 py-2 rounded-lg border text-[10px]', cfg.cls)}>
              <cfg.icon size={11} className="shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-bold">{b.msg}</p>
                <p className="opacity-70 mt-0.5">{b.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Todo OK */}
      {!hasAlert && (
        <div className="flex items-center gap-1.5 text-[10px] text-green-400/70">
          <CheckCircle2 size={10} />
          <span>Motor funcionando con normalidad</span>
        </div>
      )}
    </div>
  );
}

// ── Tarjeta de campaña ────────────────────────────────────────
function CampaignCard({ camp: initialCamp, logs: initialLogs, sessionId, onRefresh }) {
  const [camp, setCamp]   = useState(initialCamp);
  const [logs, setLogs]   = useState(initialLogs);
  const [intel, setIntel] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [busy, setBusy]   = useState(false);

  useEffect(() => { setCamp(initialCamp); }, [initialCamp]);
  useEffect(() => { setLogs(initialLogs); }, [initialLogs]);

  // ── Socket: actualizaciones en tiempo real ────────────────
  useEffect(() => {
    const onProgress = (d) => {
      if (d.campaignId !== camp.id) return;
      setCamp(prev => ({ ...prev, sent: d.sent, failed: d.failed }));
    };
    const onLog = (d) => {
      if (d.campaignId !== camp.id) return;
      setLogs(prev => [...prev.slice(-99), d]);
    };
    const onIntelligence = (d) => {
      if (d.campaignId !== camp.id) return;
      if (d.stopped) { setIntel(null); return; }
      setIntel(d);
    };
    const onCompleted = (d) => {
      if (d.campaignId !== camp.id) return;
      setCamp(prev => ({ ...prev, status: 'completed' }));
      setIntel(null);
    };
    const onPaused = (d) => {
      if (d.campaignId !== camp.id) return;
      setCamp(prev => ({ ...prev, status: 'paused' }));
    };

    socket.on('campaign:progress',    onProgress);
    socket.on('campaign:log',         onLog);
    socket.on('campaign:intelligence', onIntelligence);
    socket.on('campaign:completed',   onCompleted);
    socket.on('campaign:paused',      onPaused);
    return () => {
      socket.off('campaign:progress',    onProgress);
      socket.off('campaign:log',         onLog);
      socket.off('campaign:intelligence', onIntelligence);
      socket.off('campaign:completed',   onCompleted);
      socket.off('campaign:paused',      onPaused);
    };
  }, [camp.id]);

  const isRunning   = camp.status === 'running';
  const isScheduled = camp.status === 'scheduled';
  const isCompleted = camp.status === 'completed';
  const isPaused    = camp.status === 'paused';
  const hasAB       = !!camp.abMessages;
  const hasSequence = !!camp.sequenceId;
  const progressPct = camp.totalTargets > 0 ? (camp.sent / camp.totalTargets) * 100 : 0;
  const lastLog     = logs[logs.length - 1];
  const worstAlert  = intel?.bottlenecks?.find(b => b.severity === 'critical')
                   || intel?.bottlenecks?.find(b => b.severity === 'warning');

  const act = async (label, fn) => {
    setBusy(true);
    try { await fn(); await onRefresh(); }
    catch { toast.error(`Error al ${label}`); }
    finally { setBusy(false); }
  };

  const handleStart  = () => act('iniciar', async () => {
    const r = await api.startCampaign(camp.id);
    if (!r.success) throw new Error();
    setCamp(prev => ({ ...prev, status: 'running' }));
    toast.success('Motor iniciado');
  });
  const handlePause  = () => act('pausar', async () => {
    const r = await api.pauseCampaign(camp.id);
    if (!r.success) throw new Error();
    setCamp(prev => ({ ...prev, status: 'paused' }));
    setIntel(null);
    toast.success('Campaña pausada');
  });
  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar "${camp.name}"?`)) return;
    act('eliminar', async () => {
      const r = await api.deleteCampaign(camp.id, sessionId);
      if (!r.success) throw new Error();
      toast.success('Campaña eliminada');
    });
  };
  const handleReset  = async () => {
    if (!window.confirm(`¿Reiniciar "${camp.name}"? Se restablecerán todos los prospectos.`)) return;
    act('reiniciar', async () => {
      const r = await api.resetCampaign(camp.id, sessionId);
      if (!r.success) throw new Error();
      setCamp(prev => ({ ...prev, status: 'draft', sent: 0, failed: 0 }));
      setIntel(null);
      toast.success('Campaña reiniciada');
    });
  };
  const handleUnschedule = () => act('cancelar', async () => {
    const r = await api.unscheduleCampaign(camp.id);
    if (!r.success) throw new Error();
    toast.success('Programación cancelada');
  });
  const handleClone  = () => act('clonar', async () => {
    const r = await api.cloneCampaign(camp.id, sessionId);
    if (!r.success) throw new Error();
    toast.success(`"${camp.name}" clonada`);
  });

  return (
    <motion.div layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={clsx(
        'glass-panel flex flex-col overflow-hidden transition-all duration-500',
        isRunning && worstAlert?.severity === 'critical' ? 'border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.08)]' :
        isRunning && worstAlert?.severity === 'warning'  ? 'border-yellow-500/30' :
        isRunning ? 'border-primary-500/50 shadow-[0_0_30px_rgba(37,99,235,0.1)]' : 'hover:border-slate-600'
      )}
    >
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50 relative overflow-hidden">
        {isRunning && (
          <div className={clsx(
            'absolute top-0 left-0 w-full h-0.5 animate-pulse',
            worstAlert?.severity === 'critical' ? 'bg-gradient-to-r from-red-500 to-orange-500' :
            worstAlert?.severity === 'warning'  ? 'bg-gradient-to-r from-yellow-500 to-orange-400' :
            'bg-gradient-to-r from-primary-400 via-blue-500 to-primary-600'
          )} />
        )}
        <div className="flex justify-between items-start gap-3 relative z-10">
          <div className="min-w-0">
            <h4 className={clsx('font-black text-lg tracking-tight truncate',
              isRunning ? 'text-white' : 'text-slate-300'
            )}>{camp.name}</h4>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                <Zap size={10} className={isRunning ? 'text-primary-400' : ''} />
                {camp.dailyLimit}/día
              </span>
              {camp.nicheFilter && (
                <span className="px-2 py-0.5 bg-slate-800 rounded border border-slate-700 text-primary-400 font-bold text-[9px] uppercase tracking-widest">
                  {camp.nicheFilter}
                </span>
              )}
              {hasAB && (
                <span className="px-2 py-0.5 bg-violet-500/10 rounded border border-violet-500/20 text-violet-400 font-bold text-[9px] flex items-center gap-1">
                  <SplitSquareHorizontal size={8} /> A/B
                </span>
              )}
              {hasSequence && (
                <span className="px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/20 text-emerald-400 font-bold text-[9px] flex items-center gap-1">
                  <GitBranch size={8} /> Follow-up
                </span>
              )}
              {isScheduled && camp.scheduledAt && (
                <span className="px-2 py-0.5 bg-orange-500/10 rounded border border-orange-500/20 text-orange-400 font-bold text-[9px] flex items-center gap-1">
                  <Calendar size={8} /> {new Date(camp.scheduledAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge status={camp.status} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 flex-1 flex flex-col gap-4 bg-slate-900/30">

        {/* Progress */}
        <div>
          <div className="flex justify-between text-[10px] font-bold mb-1.5">
            <span className="text-slate-400 uppercase tracking-wider">Progreso</span>
            <span className={clsx('font-mono', isRunning ? 'text-primary-300' : 'text-white')}>
              {camp.sent} / {camp.totalTargets || '∞'}
              {camp.totalTargets > 0 && (
                <span className="text-slate-600 ml-1">({progressPct.toFixed(0)}%)</span>
              )}
            </span>
          </div>
          <div className="h-2 w-full bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className={clsx('h-full rounded-full transition-all duration-700 relative',
                isRunning && worstAlert?.severity === 'critical' ? 'bg-gradient-to-r from-red-600 to-orange-500' :
                isRunning && worstAlert?.severity === 'warning'  ? 'bg-gradient-to-r from-yellow-600 to-orange-400' :
                isRunning   ? 'bg-gradient-to-r from-primary-600 to-blue-400' :
                isCompleted ? 'bg-gradient-to-r from-blue-600 to-blue-400' : 'bg-slate-600'
              )}
              style={{ width: `${Math.max(progressPct, camp.sent > 0 ? 2 : 0)}%` }}
            >
              {isRunning && <div className="absolute inset-0 bg-white/10 animate-pulse" />}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: CheckCircle2,  label: 'Enviados', value: camp.sent,              color: 'text-green-400' },
            { icon: XCircle,       label: 'Fallidos', value: camp.failed,            color: 'text-red-400'   },
            { icon: MessageSquare, label: 'Replies',  value: camp.repliesCount || 0, color: 'text-blue-400'  },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center py-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
              <p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5 flex items-center gap-0.5">
                <s.icon size={8} /> {s.label}
              </p>
              <p className={clsx('text-xl font-black', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Funnel */}
        <MiniFunnel sent={camp.sent} replies={camp.repliesCount || 0} />

        {/* Panel de inteligencia (solo cuando corre o hay datos) */}
        <AnimatePresence>
          {(isRunning || intel) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <IntelligencePanel intel={intel} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Consola */}
        <div>
          <button onClick={() => setLogsOpen(x => !x)}
            className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-300 font-bold uppercase tracking-widest mb-1.5 transition-colors">
            <span className="flex items-center gap-1.5">
              Consola
              {isRunning && logs.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />}
            </span>
            {logsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {!logsOpen && lastLog && (
            <p className={clsx('text-[9px] font-mono truncate px-1',
              lastLog.type === 'error'   ? 'text-red-400/70' :
              lastLog.type === 'success' ? 'text-green-400/70' :
              lastLog.type === 'warning' ? 'text-yellow-400/70' : 'text-slate-600'
            )}>&gt; {lastLog.msg}</p>
          )}

          <AnimatePresence>
            {logsOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                <LiveConsole logs={logs} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700/50 bg-slate-900/50 flex gap-2 flex-wrap">
        {isScheduled ? (
          <button onClick={handleUnschedule} disabled={busy}
            className="flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 transition-all disabled:opacity-50">
            <X size={15} /> Cancelar programación
          </button>
        ) : isRunning ? (
          <button onClick={handlePause} disabled={busy}
            className="flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-50">
            <Pause size={15} /> Pausar
          </button>
        ) : isCompleted ? (
          <button onClick={handleReset} disabled={busy}
            className="flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all disabled:opacity-50">
            <RotateCcw size={15} /> Reiniciar campaña
          </button>
        ) : (
          <button onClick={handleStart} disabled={busy}
            className="flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white transition-all active:scale-95 disabled:opacity-50">
            <Play size={15} fill="currentColor" /> {isPaused ? 'Reanudar' : 'Activar motor'}
          </button>
        )}

        <button onClick={handleClone} disabled={busy} title="Clonar campaña"
          className="p-2.5 rounded-xl text-slate-500 hover:text-primary-400 hover:bg-primary-500/10 border border-transparent hover:border-primary-500/20 transition-all disabled:opacity-30">
          <Copy size={16} />
        </button>

        <button onClick={handleDelete} disabled={busy || isRunning}
          title={isRunning ? 'Pausa antes de eliminar' : 'Eliminar'}
          className="p-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          <Trash2 size={16} />
        </button>
      </div>
    </motion.div>
  );
}

// ── Grid ──────────────────────────────────────────────────────
export default function CampaignGrid({ campaigns, campaignLogs, sessionId, onRefresh }) {
  return (
    <motion.div key="campaigns"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {campaigns.map(camp => (
          <CampaignCard
            key={camp.id}
            camp={camp}
            logs={campaignLogs[camp.id] || []}
            sessionId={sessionId}
            onRefresh={onRefresh}
          />
        ))}
        {campaigns.length === 0 && (
          <div className="col-span-full py-24 flex flex-col items-center justify-center glass-panel border-dashed text-slate-500">
            <Zap size={56} className="mb-4 opacity-20" />
            <h3 className="text-xl font-bold text-slate-300">Sin campañas activas</h3>
            <p className="mt-2 text-center text-sm max-w-xs">
              Usa el botón "Nueva Campaña" para crear tu primera automatización.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
