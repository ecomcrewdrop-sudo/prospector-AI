import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Database, MapPin, Download, Upload, Search, ChevronLeft, ChevronRight, Trash2, X, Zap, Kanban, Table2, Map, Tag } from 'lucide-react';
import { clsx } from 'clsx';
import Papa from 'papaparse';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import SearchPanel from './SearchPanel';
import ProspectDrawer from './ProspectDrawer';
import CRMBoard from './CRMBoard';
import ProspectMap from './ProspectMap';

const STATUS_COLORS = {
  new:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  queued:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  contacted: 'bg-green-500/10 text-green-400 border-green-500/20',
  failed:    'bg-red-500/10 text-red-400 border-red-500/20',
  no_wa:     'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

const STAGE_COLORS = {
  new:         'bg-slate-500/15 text-slate-400',
  contacted:   'bg-blue-500/15 text-blue-400',
  replied:     'bg-yellow-500/15 text-yellow-400',
  interested:  'bg-orange-500/15 text-orange-400',
  negotiating: 'bg-purple-500/15 text-purple-400',
  won:         'bg-green-500/15 text-green-400',
  lost:        'bg-red-500/15 text-red-400',
};

const STAGE_LABELS = {
  new: 'Nuevo', contacted: 'Contactado', replied: 'Respondió',
  interested: 'Interesado', negotiating: 'Negociando', won: 'Ganado', lost: 'Perdido',
};

const SOURCE_LABELS = {
  google_maps:       '🗺️ GMaps',
  paginas_amarillas: '📒 Amarillas',
  facebook:          '📘 Facebook',
  instagram:         '📷 Instagram',
  openstreetmap:     '🌍 OSM',
  csv_import:        '📄 CSV',
};

export default function ProspectsTable({ sessionId, onStartCampaign }) {
  const [prospects, setProspects]       = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [limit]                         = useState(50);
  const [filter, setFilter]             = useState('');
  const [nicheFilter, setNicheFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [stageFilter, setStageFilter]   = useState('');
  const [selected, setSelected]         = useState(new Set());
  const [loading, setLoading]           = useState(false);
  const [viewMode, setViewMode]         = useState('table'); // 'table' | 'kanban' | 'map'
  const [drawerProspect, setDrawerProspect] = useState(null);
  const [bulkStage, setBulkStage]       = useState('');

  const fileRef      = useRef();
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const totalPages = Math.ceil(total / limit);

  const fetchProspects = useCallback(async () => {
    const snap = sessionIdRef.current;
    setLoading(true);
    try {
      const params = { page, limit };
      if (filter) params.filter = filter;
      if (nicheFilter) params.niche = nicheFilter;
      if (statusFilter) params.status = statusFilter;
      if (sourceFilter) params.source = sourceFilter;
      if (stageFilter) params.stage = stageFilter;
      const res = await api.getProspects(snap, params);
      if (snap !== sessionIdRef.current) return;
      if (res.success) { setProspects(res.data); setTotal(res.total); }
    } finally {
      if (snap === sessionIdRef.current) setLoading(false);
    }
  }, [page, filter, nicheFilter, statusFilter, sourceFilter, stageFilter, sessionId]);

  useEffect(() => {
    setProspects([]); setTotal(0); setSelected(new Set());
    setFilter(''); setNicheFilter(''); setStatusFilter(''); setSourceFilter(''); setStageFilter('');
    setPage(1);
  }, [sessionId]);

  useEffect(() => { setPage(1); }, [filter, nicheFilter, statusFilter, sourceFilter, stageFilter]);
  useEffect(() => { fetchProspects(); }, [fetchProspects]);

  const toggleSelect = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => setSelected(prev => prev.size === prospects.length ? new Set() : new Set(prospects.map(p => p.id)));

  const handleBulkDelete = async () => {
    if (!selected.size || !confirm(`¿Eliminar ${selected.size} prospectos?`)) return;
    await api.bulkDeleteProspects([...selected], sessionId);
    toast.success(`${selected.size} prospectos eliminados`);
    setSelected(new Set());
    fetchProspects();
  };

  const handleBulkStage = async () => {
    if (!selected.size || !bulkStage) return;
    await api.bulkUpdateStage([...selected], bulkStage, sessionId);
    toast.success(`${selected.size} prospectos movidos a "${STAGE_LABELS[bulkStage]}"`);
    setSelected(new Set());
    setBulkStage('');
    fetchProspects();
  };

  const handleExport = () => { window.open(api.exportProspectsUrl(sessionId), '_blank'); toast.success('Descargando CSV...'); };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const res = await api.importProspects(results.data, sessionId);
        if (res.success) { toast.success(`${res.imported} prospectos importados`); fetchProspects(); }
        else toast.error(res.error);
        fileRef.current.value = '';
      }
    });
  };

  const handleStageChange = (prospectId, newStage) => {
    setProspects(prev => prev.map(p => p.id === prospectId ? { ...p, stage: newStage } : p));
  };

  return (
    <motion.div key="prospects" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="glass-panel flex flex-col bg-dark-800/40 border border-slate-700/50 overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 pb-4 border-b border-slate-700/50 bg-slate-900/30 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <Database className="text-primary-500" /> Data Lake
            </h3>
            <p className="text-slate-400 text-sm mt-1">{total} prospectos en este espacio de trabajo</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Vista toggle */}
            <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
              {[
                { id: 'table',  icon: Table2, label: 'Tabla' },
                { id: 'kanban', icon: Kanban, label: 'CRM' },
                { id: 'map',    icon: Map,    label: 'Mapa' },
              ].map(v => (
                <button key={v.id} onClick={() => setViewMode(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    viewMode === v.id ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}>
                  <v.icon size={13} />{v.label}
                </button>
              ))}
            </div>

            {selected.size > 0 && (
              <>
                <button onClick={() => onStartCampaign([...selected])}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary-500/10 text-primary-400 border border-primary-500/20 rounded-lg text-xs font-bold hover:bg-primary-500/20 transition-colors">
                  <Zap size={13} /> Campaña ({selected.size})
                </button>
                <div className="flex items-center gap-1">
                  <select value={bulkStage} onChange={e => setBulkStage(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary-500">
                    <option value="">Mover etapa...</option>
                    {Object.entries(STAGE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  {bulkStage && (
                    <button onClick={handleBulkStage}
                      className="px-2 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold transition-colors">
                      <Tag size={12} />
                    </button>
                  )}
                </div>
                <button onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors">
                  <Trash2 size={13} /> ({selected.size})
                </button>
              </>
            )}
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors">
              <Download size={13} /> CSV
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors">
              <Upload size={13} /> Importar
            </button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </div>
        </div>

        {/* Search Panel */}
        <SearchPanel sessionId={sessionId} onProspectsAdded={fetchProspects} />

        {/* Filters */}
        {viewMode === 'table' && (
          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" size={13} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar nombre/teléfono..."
                className="bg-slate-800/80 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500 transition-all w-52 placeholder:text-slate-600"
              />
              {filter && <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"><X size={12} /></button>}
            </div>
            <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary-500">
              <option value="">Todas las etapas CRM</option>
              {Object.entries(STAGE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary-500">
              <option value="">Todos los estados</option>
              <option value="new">Nuevo</option>
              <option value="contacted">Contactado</option>
              <option value="failed">Fallido</option>
              <option value="no_wa">Sin WhatsApp</option>
            </select>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-primary-500">
              <option value="">Todas las fuentes</option>
              <option value="google_maps">Google Maps</option>
              <option value="paginas_amarillas">Páginas Amarillas</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="csv_import">CSV Import</option>
            </select>
            {(filter || statusFilter || sourceFilter || stageFilter) && (
              <button onClick={() => { setFilter(''); setStatusFilter(''); setSourceFilter(''); setStageFilter(''); }}
                className="flex items-center gap-1 px-3 py-2 bg-slate-700/50 text-slate-400 rounded-lg text-xs hover:bg-slate-700 transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {viewMode === 'kanban' && (
          <div className="p-4">
            <CRMBoard sessionId={sessionId} onProspectClick={setDrawerProspect} />
          </div>
        )}

        {viewMode === 'map' && (
          <div className="p-4">
            <ProspectMap sessionId={sessionId} onProspectClick={setDrawerProspect} />
          </div>
        )}

        {viewMode === 'table' && (
          <>
          {/* Vista Escritorio (Tabla) */}
          <div className="hidden md:block w-full overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-slate-800/90 text-slate-400 sticky top-0 z-10 backdrop-blur-xl text-xs uppercase font-semibold tracking-wide">
              <tr>
                <th className="px-5 py-4 border-b border-slate-700/50 w-10">
                  <input type="checkbox" checked={selected.size === prospects.length && prospects.length > 0}
                    onChange={toggleAll} className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 cursor-pointer" />
                </th>
                <th className="px-5 py-4 border-b border-slate-700/50">Prospecto</th>
                <th className="px-5 py-4 border-b border-slate-700/50">Contacto</th>
                <th className="px-5 py-4 border-b border-slate-700/50">Estado</th>
                <th className="px-5 py-4 border-b border-slate-700/50">Etapa CRM</th>
                <th className="px-5 py-4 border-b border-slate-700/50">Tags</th>
                <th className="px-5 py-4 border-b border-slate-700/50">Fuente</th>
                <th className="px-5 py-4 border-b border-slate-700/50 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {loading ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-500 text-sm">Cargando...</td></tr>
              ) : prospects.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <div className="flex flex-col items-center text-slate-500">
                      <Database size={40} className="mb-3 opacity-20 text-primary-500" />
                      <p className="text-lg font-bold text-slate-300">Data Lake Vacío</p>
                      <p className="text-sm mt-1">Usa el Radar de Extracción para poblar la base.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                prospects.map((p, idx) => {
                  const tags = p.tags ? JSON.parse(p.tags) : [];
                  return (
                    <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.01 }}
                      className={clsx('hover:bg-slate-800/50 transition-colors group cursor-pointer', selected.has(p.id) && 'bg-primary-500/5')}
                      onClick={() => setDrawerProspect(p)}
                    >
                      <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                          className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 cursor-pointer" />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600/20 to-primary-800/40 border border-primary-500/20 flex items-center justify-center font-bold text-primary-400 text-sm shrink-0 group-hover:scale-110 transition-transform">
                            {(p.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-200 text-sm">{p.name}</p>
                            {p.city && <p className="text-xs text-slate-500 flex items-center gap-0.5 mt-0.5"><MapPin size={9} />{p.city}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          {p.phone && <p className="font-mono text-slate-300 bg-slate-900/50 px-2 py-1 rounded text-xs border border-slate-700/50 inline-block">{p.phone}</p>}
                          {p.email && <p className="text-xs text-slate-500 truncate max-w-[160px]">{p.email}</p>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={clsx('px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest uppercase border', STATUS_COLORS[p.status] || STATUS_COLORS.new)}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold', STAGE_COLORS[p.stage] || STAGE_COLORS.new)}>
                          {STAGE_LABELS[p.stage] || 'Nuevo'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {tags.slice(0, 2).map(t => (
                            <span key={t} className="bg-primary-500/10 text-primary-300 px-1.5 py-0.5 rounded-full text-[10px]">#{t}</span>
                          ))}
                          {tags.length > 2 && <span className="text-slate-600 text-[10px]">+{tags.length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-slate-400">{SOURCE_LABELS[p.source] || p.source}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={clsx('font-mono font-bold text-sm', p.score >= 80 ? 'text-green-400' : p.score >= 60 ? 'text-yellow-400' : 'text-slate-400')}>
                          {p.score}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>

          {/* Vista Móvil (Tarjetas) */}
          <div className="md:hidden flex flex-col gap-3 p-4">
            {loading ? (
              <div className="py-10 text-center text-slate-500 text-sm">Cargando...</div>
            ) : prospects.length === 0 ? (
              <div className="py-10 text-center flex flex-col items-center text-slate-500">
                <Database size={40} className="mb-3 opacity-20 text-primary-500" />
                <p className="text-lg font-bold text-slate-300">Data Lake Vacío</p>
              </div>
            ) : (
              prospects.map((p, idx) => {
                const tags = p.tags ? JSON.parse(p.tags) : [];
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}
                    className={clsx('glass-panel p-4 flex flex-col gap-3 relative', selected.has(p.id) && 'ring-2 ring-primary-500')}
                    onClick={() => setDrawerProspect(p)}
                  >
                    <div className="absolute top-4 right-4" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
                    </div>
                    <div className="flex items-center gap-3 pr-8">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600/20 to-primary-800/40 flex items-center justify-center font-bold text-primary-400 text-lg shrink-0">
                        {(p.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-200 text-base truncate">{p.name}</p>
                        {p.phone && <p className="font-mono text-slate-400 text-xs mt-0.5">{p.phone}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className={clsx('px-2 py-1 rounded-md text-[10px] font-black tracking-widest uppercase border', STATUS_COLORS[p.status] || STATUS_COLORS.new)}>{p.status}</span>
                      <span className={clsx('px-2 py-1 rounded-full text-[10px] font-bold', STAGE_COLORS[p.stage] || STAGE_COLORS.new)}>{STAGE_LABELS[p.stage] || 'Nuevo'}</span>
                      <span className="text-xs text-slate-400 flex items-center ml-auto font-mono">Score: {p.score}</span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
          </>
        )}
      </div>

      {/* Pagination (solo en tabla) */}
      {viewMode === 'table' && totalPages > 1 && (
        <div className="px-5 py-3 border-t border-slate-700/50 bg-slate-900/30 flex items-center justify-between shrink-0">
          <p className="text-xs text-slate-500">Mostrando {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} de {total}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs text-slate-400 font-mono">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Prospect Drawer */}
      {drawerProspect && (
        <ProspectDrawer
          prospect={drawerProspect}
          sessionId={sessionId}
          onClose={() => setDrawerProspect(null)}
          onStageChange={handleStageChange}
        />
      )}
    </motion.div>
  );
}
