import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Smartphone, Zap, XCircle, Save, RefreshCw, AlertTriangle,
         Ban, GitBranch, Sparkles, Upload, Trash2, Plus, Eye, EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import SequenceBuilder from './SequenceBuilder';
import toast from 'react-hot-toast';

function SliderField({ label, desc, value, min, max, step = 1, unit, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-200">{label}</p>
          <p className="text-[10px] text-slate-500">{desc}</p>
        </div>
        <span className="text-sm font-mono font-bold text-primary-400 shrink-0 ml-4">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-primary-500"
      />
      <div className="flex justify-between text-[10px] text-slate-600">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

const SOURCE_OPTIONS = [
  { id: 'google_maps',       label: '🗺️ Google Maps',      desc: 'Principal — alta calidad' },
  { id: 'paginas_amarillas', label: '📒 Páginas Amarillas', desc: 'Directorio colombiano' },
  { id: 'facebook',          label: '📘 Facebook Business', desc: 'Negocios en Facebook' },
  { id: 'instagram',         label: '📷 Instagram',         desc: 'Próximamente', disabled: true },
];

// ── Blacklist Manager ─────────────────────────────────────────
function BlacklistSection({ sessionId }) {
  const [list, setList]     = useState([]);
  const [phone, setPhone]   = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const load = async () => {
    const r = await api.getBlacklist(sessionId);
    if (r.success) setList(r.data);
  };

  useEffect(() => { load(); }, [sessionId]);

  const handleAdd = async () => {
    if (!phone.trim()) { toast.error('Ingresa un número'); return; }
    setLoading(true);
    const r = await api.addBlacklist(phone.trim(), reason.trim(), sessionId);
    if (r.success) {
      toast.success('Número bloqueado');
      setPhone(''); setReason('');
      await load();
    } else toast.error(r.error || 'Error');
    setLoading(false);
  };

  const handleDelete = async (p) => {
    await api.deleteBlacklist(p, sessionId);
    await load();
    toast.success('Número eliminado de la lista');
  };

  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const phones = text.split(/[\n,;]/).map(p => p.replace(/\D/g, '')).filter(p => p.length >= 7);
    if (!phones.length) { toast.error('No se encontraron números válidos'); return; }
    const r = await api.importBlacklist(phones, sessionId);
    if (r.success) {
      toast.success(`${r.imported} números importados`);
      await load();
    } else toast.error(r.error || 'Error importando');
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="flex gap-3 flex-wrap">
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Número (ej: 573001234567)"
          className="flex-1 min-w-[160px] bg-dark-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:border-primary-500 outline-none text-sm"
        />
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="flex-1 min-w-[120px] bg-dark-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:border-primary-500 outline-none text-sm"
        />
        <button onClick={handleAdd} disabled={loading}
          className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50">
          <Plus size={14} /> Bloquear
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors">
          <Upload size={14} /> CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
      </div>

      {/* List */}
      {list.length === 0 ? (
        <div className="text-center py-8 text-slate-600 border border-dashed border-slate-700 rounded-xl">
          <Ban size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sin números en la blacklist</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {list.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 p-3 bg-slate-800/40 rounded-xl border border-slate-700/50">
              <div className="flex items-center gap-3 min-w-0">
                <Ban size={13} className="text-red-400 shrink-0" />
                <span className="text-sm font-mono text-slate-300">{item.phone}</span>
                {item.reason && <span className="text-xs text-slate-500 truncate">— {item.reason}</span>}
              </div>
              <button onClick={() => handleDelete(item.phone)}
                className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors shrink-0">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600">{list.length} número{list.length !== 1 ? 's' : ''} bloqueado{list.length !== 1 ? 's' : ''} · Los prospectos en blacklist serán omitidos automáticamente</p>
    </div>
  );
}

// ── AI Settings ───────────────────────────────────────────────
function AISection() {
  const [apiKey, setApiKey]   = useState('');
  const [show, setShow]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getAISettings().then(r => {
      if (r.success && r.apiKey) setApiKey(r.apiKey);
    });
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) { toast.error('Ingresa la API Key'); return; }
    setLoading(true);
    const r = await api.saveAISettings({ apiKey: apiKey.trim() });
    if (r.success) {
      toast.success('API Key guardada');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else toast.error(r.error || 'Error guardando');
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
        <p className="text-xs text-violet-300 font-medium">
          El Asistente IA usa Claude de Anthropic para generar mensajes personalizados de prospección.
          Obtén tu API Key en console.anthropic.com.
        </p>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Anthropic API Key</label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={show ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-violet-500 outline-none transition-all text-sm font-mono pr-10"
            />
            <button
              onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button onClick={handleSave} disabled={loading}
            className={clsx(
              'px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all',
              saved ? 'bg-green-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50'
            )}>
            <Save size={14} /> {loading ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>
      </div>
      <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30 space-y-1.5 text-xs text-slate-500">
        <p>• El modelo usado es <span className="text-violet-400 font-mono">claude-sonnet-4-6</span></p>
        <p>• La clave se guarda en tu archivo <span className="font-mono">.env</span> local (nunca en la nube)</p>
        <p>• Cada generación consume aproximadamente 200-400 tokens</p>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function SettingsPanel({ sessions, currentSessionId, onRefresh }) {
  const session = sessions.find(s => s.id === currentSessionId) || {};
  const [tab, setTab]           = useState('session');
  const [name, setName]         = useState(session.name || '');
  const [baseDelay, setBaseDelay]   = useState(session.antiBanBaseDelay  ?? 180);
  const [batchSize, setBatchSize]   = useState(session.antiBanBatchSize  ?? 5);
  const [batchPause, setBatchPause] = useState(session.antiBanBatchPause ?? 900);
  const [intraDelay, setIntraDelay] = useState(session.antiBanIntraDelay ?? 25);
  const [activeSrc, setActiveSrc]   = useState((session.activeSources || 'google_maps').split(','));

  useEffect(() => {
    setName(session.name || '');
    setBaseDelay(session.antiBanBaseDelay   ?? 180);
    setBatchSize(session.antiBanBatchSize   ?? 5);
    setBatchPause(session.antiBanBatchPause ?? 900);
    setIntraDelay(session.antiBanIntraDelay ?? 25);
    setActiveSrc((session.activeSources || 'google_maps').split(','));
  }, [currentSessionId, sessions]);

  const toggleSource = (id) => setActiveSrc(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('El nombre no puede estar vacío'); return; }
    if (!activeSrc.length) { toast.error('Selecciona al menos una fuente'); return; }
    const res = await api.updateSession(currentSessionId, {
      name, antiBanBaseDelay: baseDelay, antiBanBatchSize: batchSize,
      antiBanBatchPause: batchPause, antiBanIntraDelay: intraDelay,
      activeSources: activeSrc.join(','),
    });
    if (res.success) { toast.success('Configuración guardada'); onRefresh(); }
    else toast.error(res.error || 'Error al guardar');
  };

  const handleDeleteSession = async () => {
    if (!window.confirm('¿Eliminar este espacio de trabajo permanentemente? Esto borrará TODOS sus prospectos y campañas.')) return;
    const res = await api.deleteSession(currentSessionId);
    if (res.success) { toast.success('Espacio eliminado'); onRefresh(); }
  };

  const handleClearProspects = async () => {
    if (!window.confirm('¿Limpiar TODOS los prospectos de este espacio?')) return;
    const res = await api.clearProspects(currentSessionId);
    if (res.success) { toast.success('Prospectos eliminados'); onRefresh(); }
  };

  const handleResetWA = async () => {
    const tid = toast.loading('Reiniciando motor WA...');
    try {
      await api.resetWA(currentSessionId);
      toast.dismiss(tid);
      toast.success('Motor reiniciado — espera el QR');
    } catch {
      toast.dismiss(tid);
      toast.error('Error al reiniciar motor WA');
    }
  };

  const TABS = [
    { id: 'session',    label: 'Sesión',     icon: Smartphone },
    { id: 'antibaan',  label: 'Anti-Ban',    icon: Zap },
    { id: 'blacklist', label: 'Blacklist',   icon: Ban },
    { id: 'sequences', label: 'Secuencias',  icon: GitBranch },
    { id: 'ai',        label: 'IA',          icon: Sparkles },
  ];

  return (
    <motion.div key="settings" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="space-y-7 max-w-4xl mx-auto pb-16"
    >
      <div className="flex items-center gap-4">
        <div className="p-3 bg-primary-500/10 rounded-2xl"><Settings size={28} className="text-primary-400" /></div>
        <div>
          <h3 className="text-2xl font-black text-white">Configuración del Sistema</h3>
          <p className="text-slate-400 text-sm">Control total sobre tu infraestructura de prospección.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors',
              tab === t.id ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'session' && (
          <motion.div key="session" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-7">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
              <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50 space-y-5">
                <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  <Smartphone size={14} className="text-primary-400" /> Perfil del Espacio
                </h4>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Nombre</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-primary-500 outline-none transition-all text-sm"
                  />
                </div>
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-bold">ID del Espacio</span>
                    <span className="text-[10px] font-mono text-slate-500">{currentSessionId}</span>
                  </div>
                </div>
                <div>
                  <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Fuentes de scraping activas</h5>
                  <div className="space-y-2">
                    {SOURCE_OPTIONS.map(s => (
                      <button key={s.id}
                        onClick={() => !s.disabled && toggleSource(s.id)}
                        disabled={s.disabled}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all border text-left',
                          s.disabled ? 'bg-slate-800/20 text-slate-600 border-slate-800/50 cursor-not-allowed'
                            : activeSrc.includes(s.id) ? 'bg-primary-500/15 text-white border-primary-500/30'
                            : 'bg-slate-800/50 text-slate-500 border-slate-700/50 hover:border-slate-600'
                        )}
                      >
                        <div className={clsx('w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0',
                          s.disabled ? 'border-slate-700' :
                          activeSrc.includes(s.id) ? 'bg-primary-500 border-primary-500' : 'border-slate-600'
                        )}>
                          {!s.disabled && activeSrc.includes(s.id) && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span>{s.label}</span>
                        <span className={clsx('text-[10px] ml-auto', s.disabled ? 'text-slate-600 italic' : 'text-slate-500')}>{s.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50 space-y-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                    <Smartphone size={14} className="text-primary-400" /> Motor WhatsApp
                  </h4>
                  <button onClick={handleResetWA}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <RefreshCw size={15} /> Reiniciar Motor WA
                  </button>
                </div>
                <div className="glass-panel p-7 bg-red-500/5 border border-red-500/20 space-y-4">
                  <h4 className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                    <AlertTriangle size={14} /> Zona de Mantenimiento
                  </h4>
                  <div className="flex flex-col gap-3">
                    <button onClick={handleClearProspects}
                      className="py-3 bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500/30 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <XCircle size={15} /> Limpiar Todos los Prospectos
                    </button>
                    <button onClick={handleDeleteSession}
                      className="py-3 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white border border-slate-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <XCircle size={15} /> Eliminar Espacio Completo
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={handleSave}
                className="px-8 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all active:scale-95 flex items-center gap-2 text-sm"
              >
                <Save size={16} /> Guardar Configuración
              </button>
            </div>
          </motion.div>
        )}

        {tab === 'antibaan' && (
          <motion.div key="antibaan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-7">
            <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50 space-y-5 max-w-xl">
              <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Zap size={14} className="text-primary-400" /> Algoritmo Anti-Ban
              </h4>
              <div className="space-y-5">
                <SliderField label="Intervalo Base"  desc="Espera mínima entre prospectos"        value={baseDelay}  min={60}  max={600}  unit="s"      onChange={setBaseDelay} />
                <SliderField label="Intra-Delay"     desc="Pausa entre mensajes de una secuencia" value={intraDelay} min={5}   max={120}  unit="s"      onChange={setIntraDelay} />
                <SliderField label="Batch Size"      desc="Envíos antes de una pausa larga"       value={batchSize}  min={1}   max={20}   unit=" envíos" onChange={setBatchSize} />
                <SliderField label="Batch Pause"     desc="Descanso del motor entre lotes"        value={batchPause} min={300} max={3600} step={60} unit="s" onChange={setBatchPause} />
              </div>
              <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
                <p className="text-[10px] text-slate-500">
                  Resumen: pausa base <span className="text-primary-400 font-bold">{baseDelay}s</span>, cada <span className="text-primary-400 font-bold">{batchSize}</span> envíos descanso de <span className="text-primary-400 font-bold">{(batchPause / 60).toFixed(0)}min</span>
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSave}
                className="px-8 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold transition-all active:scale-95 flex items-center gap-2 text-sm"
              >
                <Save size={16} /> Guardar Anti-Ban
              </button>
            </div>
          </motion.div>
        )}

        {tab === 'blacklist' && (
          <motion.div key="blacklist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50 space-y-4">
              <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Ban size={14} className="text-red-400" /> Blacklist — Números Bloqueados
              </h4>
              <p className="text-xs text-slate-500">Los números en esta lista serán omitidos automáticamente en todas las campañas.</p>
              <BlacklistSection sessionId={currentSessionId} />
            </div>
          </motion.div>
        )}

        {tab === 'sequences' && (
          <motion.div key="sequences" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50">
              <SequenceBuilder sessionId={currentSessionId} />
            </div>
          </motion.div>
        )}

        {tab === 'ai' && (
          <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="glass-panel p-7 bg-slate-900/40 border border-slate-700/50 space-y-4 max-w-xl">
              <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={14} className="text-violet-400" /> Asistente IA — Configuración
              </h4>
              <AISection />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
