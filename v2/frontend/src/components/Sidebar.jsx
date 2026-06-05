import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, Database, Zap, BarChart2, MessageCircle,
  Settings, Plus, Smartphone, CheckCircle2, RefreshCw, AlertTriangle, FileText,
  KanbanSquare, Map, Search, X, Radar
} from 'lucide-react';

const STATE_LABELS = {
  INITIALIZING:  'Iniciando motor...',
  QR_READY:      'Escanea el QR',
  CONNECTED:     'Conectado',
  AUTHENTICATED: 'Autenticando...',
  DISCONNECTED:  'Desconectado',
  AUTH_FAILED:   'Error de autenticación',
  FAILED:        'Fallo — reiniciar',
  HIBERNATED:    'Hibernado',
};

const NAV_ITEMS = [
  { id: 'dashboard',  icon: LayoutDashboard, label: 'Panel Principal' },
  { id: 'prospects',  icon: Database,        label: 'Data Lake' },
  { id: 'search',     icon: Radar,           label: 'Extracción' },
  { id: 'crm',        icon: KanbanSquare,    label: 'CRM Pipeline' },
  { id: 'campaigns',  icon: Zap,             label: 'Campañas' },
  { id: 'templates',  icon: FileText,        label: 'Plantillas' },
  { id: 'analytics',  icon: BarChart2,       label: 'Analytics' },
  { id: 'inbox',      icon: MessageCircle,   label: 'Inbox WA' },
  { id: 'map',        icon: Map,             label: 'Mapa' },
  { id: 'settings',   icon: Settings,        label: 'Configuración' },
];

function WAStatusDot({ state }) {
  if (state === 'CONNECTED') return <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />;
  if (state === 'QR_READY')  return <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />;
  if (state === 'FAILED')    return <span className="w-2 h-2 rounded-full bg-red-500" />;
  return <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />;
}

// Global search overlay
function GlobalSearch({ onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const shortcuts = [
    { key: 'CRM', label: 'Ir a CRM Pipeline', tab: 'crm' },
    { key: 'Mapa', label: 'Ir al Mapa', tab: 'map' },
    { key: 'Analytics', label: 'Ver Analytics', tab: 'analytics' },
    { key: 'Campañas', label: 'Gestionar Campañas', tab: 'campaigns' },
    { key: 'Inbox', label: 'Ver mensajes recibidos', tab: 'inbox' },
    { key: 'Configuración', label: 'Ajustes del sistema', tab: 'settings' },
  ];

  const filtered = query.trim()
    ? shortcuts.filter(s => s.key.toLowerCase().includes(query.toLowerCase()) || s.label.toLowerCase().includes(query.toLowerCase()))
    : shortcuts;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: -10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <Search size={16} className="text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar o navegar..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered[0]) { onNavigate(filtered[0].tab); onClose(); }
            }}
          />
          <button onClick={onClose} className="text-slate-600 hover:text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto custom-scrollbar">
          {filtered.map(item => (
            <button
              key={item.tab}
              onClick={() => { onNavigate(item.tab); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-primary-500/10 hover:text-white text-slate-300 transition-colors text-left"
            >
              <span className="text-[10px] font-bold text-primary-400 uppercase tracking-widest w-20 shrink-0">{item.key}</span>
              <span>{item.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-6 text-center text-slate-600 text-sm">Sin resultados</div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-600">
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 font-mono">↵</kbd> Ir</span>
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 font-mono">Esc</kbd> Cerrar</span>
          <span className="ml-auto opacity-60">Ctrl+K para abrir</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Sidebar({ activeTab, setActiveTab, sessions, currentSessionId, setCurrentSessionId, waStatus, unreadReplies, onNewSession }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const curStatus = waStatus[currentSessionId] || { connected: false, state: 'DISCONNECTED', qr: null };

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {searchOpen && (
        <GlobalSearch
          onClose={() => setSearchOpen(false)}
          onNavigate={(tab) => setActiveTab(tab)}
        />
      )}

      <aside className="w-72 flex flex-col shrink-0 relative z-20">
        <div className="glass-panel h-full flex flex-col overflow-hidden border border-slate-700/50 shadow-2xl bg-dark-800/40">

          {/* Logo */}
          <div className="p-7 border-b border-slate-700/50 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/10 to-transparent pointer-events-none" />
            <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-br from-white via-slate-200 to-slate-500 bg-clip-text text-transparent">
              PROSPECTOR<span className="text-primary-500">.AI</span>
            </h1>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="px-2 py-0.5 rounded-md bg-primary-500/20 border border-primary-500/30 text-[10px] font-bold text-primary-400 tracking-widest uppercase">Enterprise V2.1</span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            </div>
          </div>

          {/* Global search trigger */}
          <div className="px-5 pt-4 pb-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 rounded-xl text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Search size={13} />
              <span className="flex-1 text-left">Buscar o navegar...</span>
              <kbd className="text-[9px] bg-slate-700 text-slate-600 px-1.5 py-0.5 rounded font-mono">Ctrl+K</kbd>
            </button>
          </div>

          {/* Workspaces */}
          <div className="px-5 py-4 border-b border-slate-700/50 bg-slate-900/30">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2.5">Espacios de Trabajo</label>
            <div className="space-y-1 max-h-44 overflow-y-auto custom-scrollbar pr-1">
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => setCurrentSessionId(s.id)}
                  className={clsx(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-bold transition-all border',
                    currentSessionId === s.id
                      ? 'bg-primary-600/20 text-white border-primary-500/40 shadow-[0_0_12px_rgba(37,99,235,0.1)]'
                      : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-800/60 hover:text-slate-200'
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <WAStatusDot state={waStatus[s.id]?.state || s.status} />
                    <span className="truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.status === 'CONNECTED' && <CheckCircle2 size={10} className="text-green-400 shrink-0" />}
                    {currentSessionId === s.id && <div className="w-1 h-3 bg-primary-500 rounded-full shrink-0" />}
                  </div>
                </button>
              ))}
              <button
                onClick={onNewSession}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-primary-400 hover:bg-primary-500/10 transition-all border border-dashed border-primary-500/30 mt-1"
              >
                <Plus size={13} /> Nuevo Espacio
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto custom-scrollbar">
            {NAV_ITEMS.map(item => {
              const active = activeTab === item.id;
              const showBadge = item.id === 'inbox' && unreadReplies > 0;
              const isNew = item.id === 'crm' || item.id === 'map';
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={clsx(
                    'w-full flex items-center gap-4 px-5 py-3 rounded-xl font-semibold transition-all duration-300 relative group overflow-hidden',
                    active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {active && (
                    <motion.div layoutId="activeNav" className="absolute inset-0 bg-gradient-to-r from-primary-600/20 to-primary-600/5 border border-primary-500/20 rounded-xl" />
                  )}
                  <item.icon size={19} className={clsx('relative z-10 transition-colors shrink-0', active ? 'text-primary-400' : 'group-hover:text-primary-400/70')} />
                  <span className="relative z-10 tracking-wide flex-1 text-left text-sm">{item.label}</span>
                  {showBadge && (
                    <span className="relative z-10 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                      {unreadReplies > 99 ? '99+' : unreadReplies}
                    </span>
                  )}
                  {isNew && !active && (
                    <span className="relative z-10 text-[8px] font-black bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider">New</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* WA Status Footer */}
          <div className="p-5 border-t border-slate-700/50 bg-dark-900/50">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone size={17} className={clsx('shrink-0', curStatus.connected ? 'text-green-400' : curStatus.state === 'FAILED' ? 'text-red-400' : 'text-yellow-500 animate-pulse')} />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Motor WA</p>
                  <p className={clsx('text-xs font-bold truncate',
                    curStatus.connected ? 'text-slate-200' :
                    curStatus.state === 'FAILED' ? 'text-red-400' : 'text-yellow-400'
                  )}>
                    {curStatus.connected
                      ? (curStatus.name || curStatus.phone || 'Conectado')
                      : STATE_LABELS[curStatus.state] || curStatus.state || 'Sin estado'}
                  </p>
                </div>
              </div>
              {curStatus.connected
                ? <CheckCircle2 size={15} className="text-green-500 shrink-0" />
                : curStatus.state === 'FAILED'
                ? <AlertTriangle size={15} className="text-red-400 shrink-0" />
                : <RefreshCw size={15} className="text-slate-500 animate-spin shrink-0" />
              }
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
