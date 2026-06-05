import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Plus, Trash2, Save, X, Edit3, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const SPINTAX_HINT = '{Hola|Hey|Buenos días} {nombre}, te escribo porque...';
const VARS = ['{nombre}', '{Hola|Hey}', '{te|le}'];

function parseMessages(content) {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [content];
  } catch {
    return [content];
  }
}

// ── Editor de plantilla (crear / editar) ─────────────────────
function TemplateEditor({ template, onSave, onCancel }) {
  const [name, setName] = useState(template?.name || '');
  const [messages, setMessages] = useState(
    template ? parseMessages(template.content) : ['']
  );
  const [saving, setSaving] = useState(false);

  const setMsg = (i, val) => { const m = [...messages]; m[i] = val; setMessages(m); };
  const addMsg = () => setMessages([...messages, '']);
  const removeMsg = (i) => setMessages(messages.filter((_, idx) => idx !== i));

  const insertVar = (i, v) => {
    setMsg(i, (messages[i] || '') + v);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Escribe un nombre'); return; }
    const filled = messages.filter(m => m.trim());
    if (!filled.length) { toast.error('Escribe al menos un mensaje'); return; }
    setSaving(true);
    try {
      const res = template
        ? await api.updateTemplate(template.id, { name, messages: filled })
        : await api.createTemplate({ name, messages: filled });
      if (res.success) {
        toast.success(template ? 'Plantilla actualizada' : 'Plantilla guardada');
        onSave();
      } else toast.error(res.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="bg-slate-800/60 border border-primary-500/30 rounded-2xl p-6 space-y-5"
    >
      {/* Nombre */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nombre de la plantilla</label>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Ej. Presentación Salud · Spintax"
          className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
        />
      </div>

      {/* Variables rápidas */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Variables:</span>
        {VARS.map(v => (
          <button key={v} onClick={() => insertVar(messages.length - 1, v)}
            className="px-2.5 py-1 bg-slate-700/80 text-primary-300 border border-slate-600/50 rounded-lg text-[11px] font-mono hover:bg-primary-500/20 hover:border-primary-500/40 transition-all">
            {v}
          </button>
        ))}
        <span className="text-[10px] text-slate-600 ml-1">click inserta en el último mensaje</span>
      </div>

      {/* Mensajes */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          Secuencia de mensajes <span className="text-slate-600 font-normal normal-case">(se envían en orden con pausa entre cada uno)</span>
        </label>
        {messages.map((msg, idx) => (
          <div key={idx} className="relative group">
            <div className="absolute top-3 left-3 w-5 h-5 bg-slate-800 text-slate-400 rounded-full flex items-center justify-center text-[10px] font-bold border border-slate-700 z-10 select-none">
              {idx + 1}
            </div>
            <textarea
              value={msg} onChange={e => setMsg(idx, e.target.value)} rows={3}
              placeholder={idx === 0 ? SPINTAX_HINT : `Mensaje ${idx + 1}...`}
              className="w-full bg-dark-900 border border-slate-700 rounded-xl pl-11 pr-11 py-3 text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all font-mono text-sm resize-none placeholder:text-slate-600"
            />
            {messages.length > 1 && (
              <button onClick={() => removeMsg(idx)}
                className="absolute top-3 right-3 p-1.5 text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 z-10">
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addMsg}
          className="w-full py-2.5 border-2 border-dashed border-slate-700 text-slate-400 rounded-xl font-bold flex items-center justify-center gap-2 hover:border-primary-500/50 hover:text-primary-400 transition-colors text-sm">
          <Plus size={15} /> Añadir mensaje a la secuencia
        </button>
      </div>

      {/* Acciones */}
      <div className="flex justify-end gap-3 pt-1">
        <button onClick={onCancel}
          className="px-5 py-2 rounded-xl font-bold text-slate-400 hover:bg-slate-700 transition-colors text-sm">
          Cancelar
        </button>
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-slate-700 text-white rounded-xl font-bold transition-all flex items-center gap-2 text-sm shadow-[0_0_12px_rgba(37,99,235,0.25)]">
          <Save size={15} /> {saving ? 'Guardando...' : template ? 'Guardar cambios' : 'Crear plantilla'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Tarjeta de plantilla ─────────────────────────────────────
function TemplateCard({ tpl, onEdit, onDelete, onDuplicate }) {
  const [expanded, setExpanded] = useState(false);
  const messages = parseMessages(tpl.content);

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden hover:border-slate-600 transition-all duration-300"
    >
      {/* Header */}
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-primary-400" />
          </div>
          <div className="min-w-0">
            <h4 className="font-black text-white text-sm truncate">{tpl.name}</h4>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {messages.length} mensaje{messages.length !== 1 ? 's' : ''} · {new Date(tpl.createdAt).toLocaleDateString('es-CO')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onDuplicate(tpl)} title="Duplicar"
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 rounded-lg transition-colors">
            <Copy size={14} />
          </button>
          <button onClick={() => onEdit(tpl)} title="Editar"
            className="p-2 text-slate-500 hover:text-primary-400 hover:bg-primary-500/10 rounded-lg transition-colors">
            <Edit3 size={14} />
          </button>
          <button onClick={() => onDelete(tpl.id)} title="Eliminar"
            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
          <button onClick={() => setExpanded(x => !x)}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 rounded-lg transition-colors">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Preview del primer mensaje siempre visible */}
      <div className="px-5 pb-4">
        <p className="font-mono text-xs text-slate-400 bg-black/30 rounded-xl px-3 py-2.5 border border-slate-700/50 truncate">
          {messages[0] || <span className="text-slate-600 italic">Sin contenido</span>}
        </p>
      </div>

      {/* Mensajes expandidos */}
      <AnimatePresence>
        {expanded && messages.length > 1 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-700/40"
          >
            <div className="px-5 py-4 space-y-2">
              {messages.slice(1).map((m, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 2}</span>
                  <p className="font-mono text-xs text-slate-400 bg-black/20 rounded-lg px-3 py-2 border border-slate-700/30 flex-1">{m}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Panel principal ──────────────────────────────────────────
export default function TemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.getTemplates();
      if (res.success) setTemplates(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta plantilla?')) return;
    await api.deleteTemplate(id);
    toast.success('Plantilla eliminada');
    fetchTemplates();
  };

  const handleDuplicate = async (tpl) => {
    const messages = parseMessages(tpl.content);
    const res = await api.createTemplate({ name: tpl.name + ' (copia)', messages });
    if (res.success) { toast.success('Plantilla duplicada'); fetchTemplates(); }
  };

  const handleSaved = () => {
    setCreating(false);
    setEditing(null);
    fetchTemplates();
  };

  const filtered = templates.filter(t =>
    !search.trim() || t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div key="templates" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <FileText className="text-primary-400" size={26} /> Plantillas de Mensajes
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {templates.length} plantilla{templates.length !== 1 ? 's' : ''} guardada{templates.length !== 1 ? 's' : ''} · Disponibles en todas las campañas
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setCreating(true); }}
          disabled={creating}
          className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold flex items-center gap-2 text-sm shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all active:scale-95 disabled:opacity-50"
        >
          <Plus size={16} /> Nueva Plantilla
        </button>
      </div>

      {/* Editor de creación */}
      <AnimatePresence>
        {creating && (
          <TemplateEditor
            key="new"
            onSave={handleSaved}
            onCancel={() => setCreating(false)}
          />
        )}
      </AnimatePresence>

      {/* Buscador */}
      {templates.length > 3 && (
        <div className="relative">
          <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar plantilla..."
            className="w-full max-w-xs bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500 transition-all placeholder:text-slate-600"
          />
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="text-center py-20 text-slate-500">Cargando plantillas...</div>
      ) : filtered.length === 0 && !creating ? (
        <div className="py-24 flex flex-col items-center justify-center glass-panel border-dashed text-slate-500">
          <FileText size={56} className="mb-4 opacity-20 text-primary-400" />
          <h3 className="text-xl font-bold text-slate-300">Sin plantillas aún</h3>
          <p className="mt-2 text-center text-sm max-w-xs">Crea tu primera plantilla con spintax para reutilizarla en múltiples campañas.</p>
          <button onClick={() => setCreating(true)}
            className="mt-6 px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold text-sm transition-all">
            Crear mi primera plantilla
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnimatePresence>
            {filtered.map(tpl => (
              editing?.id === tpl.id ? (
                <motion.div key={tpl.id} layout className="lg:col-span-2">
                  <TemplateEditor
                    template={tpl}
                    onSave={handleSaved}
                    onCancel={() => setEditing(null)}
                  />
                </motion.div>
              ) : (
                <TemplateCard
                  key={tpl.id}
                  tpl={tpl}
                  onEdit={setEditing}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                />
              )
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Referencia de spintax */}
      <div className="glass-panel p-5 border border-slate-700/40 rounded-2xl space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Guía rápida de Spintax</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
          {[
            ['{Hola|Hey|Buenos días}', 'Selecciona aleatoriamente una opción'],
            ['{nombre}',               'Reemplaza con el nombre del prospecto'],
            ['{te|le}',                'Varía el tratamiento (tú/usted)'],
            ['{puede|puede que|quizás}','Varía el tono del mensaje'],
          ].map(([ex, desc]) => (
            <div key={ex} className="flex items-start gap-3 bg-black/30 rounded-xl px-3 py-2.5 border border-slate-700/40">
              <span className="text-primary-300 shrink-0">{ex}</span>
              <span className="text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
