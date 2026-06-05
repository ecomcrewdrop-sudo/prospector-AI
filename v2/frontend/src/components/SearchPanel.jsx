import { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Activity } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import socket from '../lib/socket';
import toast from 'react-hot-toast';
import InstagramSearch from './InstagramSearch';

const SOURCES = [
  { id: 'google_maps',       label: '🗺️ Google Maps',      desc: 'Principal — mayor calidad' },
  { id: 'paginas_amarillas', label: '📒 Páginas Amarillas', desc: 'Directorio colombiano' },
  { id: 'facebook',          label: '📘 Facebook Business', desc: 'Negocios en Facebook Places' },
  { id: 'instagram',         label: '📷 Instagram',         desc: 'Hashtag + Business Discovery API' },
];

export default function SearchPanel({ sessionId, onProspectsAdded }) {
  const [query, setQuery]           = useState('');
  const [location, setLocation]     = useState('');
  const [maxResults, setMax]        = useState(20);
  const [sources, setSources]       = useState(['google_maps']);
  const [isSearching, setSearching] = useState(false);
  const [logs, setLogs]             = useState([]);
  const [progress, setProgress]     = useState(0);
  const [activeSource, setActiveSource] = useState(null); // null = all, 'instagram' = IG panel
  const logsEndRef = useRef(null);

  useEffect(() => {
    const event = `search:progress:${sessionId}`;
    const handler = (prog) => {
      setProgress(prog.pct || 0);
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: prog.text }].slice(-80));
      if (prog.pct >= 100) setSearching(false);
    };
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [sessionId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const toggleSource = (id) => {
    if (id === 'instagram') {
      setActiveSource(prev => prev === 'instagram' ? null : 'instagram');
      return;
    }
    setActiveSource(null);
    setSources(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleSearch = async () => {
    if (!query.trim() || !location.trim()) { toast.error('Escribe el nicho y la ubicación'); return; }
    if (!sources.length) { toast.error('Selecciona al menos una fuente'); return; }
    setSearching(true);
    setLogs([{ time: new Date().toLocaleTimeString(), text: `🚀 Iniciando búsqueda: "${query}" en ${location}` }]);
    setProgress(5);
    try {
      const res = await api.search({ query: query.trim(), location: location.trim(), maxResults, sources, sessionId });
      if (res.success) {
        toast.success(`✅ ${res.inserted} nuevos prospectos guardados (${res.total} encontrados)`);
        onProspectsAdded?.();
      } else {
        toast.error(res.error || 'Error en la búsqueda');
      }
    } catch (e) {
      toast.error('Error de conexión con el servidor');
      console.error(e);
    } finally {
      setSearching(false);
      setProgress(100);
    }
  };

  return (
    <div className="space-y-4">
      {/* Source selector tabs */}
      <div className="flex flex-wrap gap-2">
        {SOURCES.map(s => (
          <button key={s.id}
            onClick={() => toggleSource(s.id)}
            title={s.desc}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
              s.id === 'instagram' && activeSource === 'instagram'
                ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                : s.id !== 'instagram' && sources.includes(s.id) && activeSource !== 'instagram'
                ? 'bg-primary-500/20 text-primary-300 border-primary-500/40'
                : 'bg-slate-800/60 text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Instagram panel */}
      {activeSource === 'instagram' ? (
        <div className="bg-dark-900/80 p-5 rounded-2xl border border-violet-500/20">
          <InstagramSearch sessionId={sessionId} onProspectsImported={onProspectsAdded} />
        </div>
      ) : (
        /* Standard search panel */
        <div className="bg-dark-900/80 p-5 rounded-2xl border border-slate-700/60 relative overflow-hidden">
          {isSearching && (
            <div className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-primary-600 to-blue-400 transition-all duration-500" style={{ width: `${progress}%` }} />
          )}

          <h4 className="text-xs font-bold text-primary-400 uppercase tracking-widest flex items-center gap-2 mb-4">
            <Search size={13} /> Radar de Extracción
          </h4>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-[2]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
                type="text" placeholder="Nicho (ej. Odontólogos)"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all placeholder:text-slate-600"
              />
            </div>
            <div className="relative flex-[2]">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input value={location} onChange={e => setLocation(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
                type="text" placeholder="Ciudad (ej. Bogotá)"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all placeholder:text-slate-600"
              />
            </div>
            <div className="relative w-24 shrink-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">#</span>
              <input value={maxResults} onChange={e => setMax(parseInt(e.target.value) || 20)}
                type="number" min={5} max={100}
                className="w-full bg-dark-900 border border-slate-700 rounded-xl pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500 transition-all"
              />
            </div>
            <button onClick={handleSearch} disabled={isSearching}
              className="px-6 bg-primary-600 hover:bg-primary-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center gap-2 shrink-0"
            >
              {isSearching ? <Activity className="animate-spin" size={16} /> : <Search size={16} />}
              {isSearching ? 'Buscando...' : 'Extraer'}
            </button>
          </div>

          {/* Live terminal */}
          <div className="h-44 bg-black/70 rounded-xl border border-slate-800/80 p-3 overflow-y-auto font-mono text-[11px] flex flex-col gap-0.5 custom-scrollbar">
            {logs.length === 0 ? (
              <span className="text-slate-600">&gt; Sistema listo. Esperando comando de extracción...</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} className="text-slate-300 leading-relaxed">
                  <span className="text-primary-500/60">[{l.time}]</span>{' '}
                  <span className={
                    l.text.startsWith('✅') ? 'text-green-400' :
                    l.text.startsWith('❌') ? 'text-red-400' :
                    l.text.startsWith('⚠️') ? 'text-yellow-400' : 'text-slate-300'
                  }>{l.text}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
