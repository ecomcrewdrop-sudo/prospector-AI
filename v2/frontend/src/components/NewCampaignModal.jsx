import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, XCircle, Plus, Play, CheckCircle2, Calendar, FileText, ChevronDown,
         Image as ImageIcon, Settings2, Sparkles, SplitSquareHorizontal, GitBranch,
         Upload, X, Eye, MessageSquare } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api';
import AIAssistant from './AIAssistant';
import toast from 'react-hot-toast';

const DEFAULT_FORM = {
  name: '', messages: ['{Hola|Buenas} {nombre}, ¿cómo estás?'], limit: 80,
  niche: '', scheduledAt: '',
  imageUrl: '', imageCaption: '',
  abEnabled: false, abMessages: ['', ''],
  sequenceId: '',
};

const VARIABLES = [
  { label: '{nombre}',      desc: 'Nombre del negocio' },
  { label: '{ciudad}',      desc: 'Ciudad del prospecto' },
  { label: '{categoria}',   desc: 'Categoría / nicho' },
  { label: '{website}',     desc: 'Sitio web' },
  { label: '{calificacion}',desc: 'Rating de Google' },
  { label: '{score}',       desc: 'Score interno' },
  { label: '{Hola|Hey}',   desc: 'Spintax aleatorio' },
];

function parseMessages(content) {
  try {
    const p = JSON.parse(content);
    return Array.isArray(p) ? p : [content];
  } catch { return [content]; }
}

// ── Selector de plantillas ────────────────────────────────────
function TemplatePicker({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = async () => {
    if (!open && !templates.length) {
      setLoading(true);
      const res = await api.getTemplates();
      if (res.success) setTemplates(res.data);
      setLoading(false);
    }
    setOpen(x => !x);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle}
        className="flex items-center gap-2 px-3 py-2 bg-slate-700/60 hover:bg-slate-700 border border-slate-600/60 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-all"
      >
        <FileText size={13} className="text-primary-400" />
        Cargar plantilla
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
            className="absolute right-0 top-full mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-700/60 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mis plantillas</div>
            {loading ? (
              <div className="py-6 text-center text-xs text-slate-500">Cargando...</div>
            ) : templates.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">Sin plantillas guardadas aún</div>
            ) : (
              <div className="max-h-60 overflow-y-auto custom-scrollbar">
                {templates.map(tpl => {
                  const msgs = parseMessages(tpl.content);
                  return (
                    <button key={tpl.id} onClick={() => { onSelect(msgs); setOpen(false); toast.success(`Plantilla "${tpl.name}" cargada`); }}
                      className="w-full text-left px-4 py-3 hover:bg-primary-500/10 hover:border-l-2 hover:border-primary-500 transition-all group"
                    >
                      <p className="text-sm font-bold text-slate-200 group-hover:text-white truncate">{tpl.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{msgs[0]}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Dropzone de imagen ────────────────────────────────────────
function ImageDropzone({ imageUrl, onUpload, onClear }) {
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback(async (accepted) => {
    if (!accepted[0]) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', accepted[0]);
      const res = await api.uploadImage(fd);
      if (res.success) {
        onUpload(res.url);
        toast.success('Imagen subida');
      } else {
        toast.error(res.error || 'Error subiendo imagen');
      }
    } catch { toast.error('Error de red'); }
    setUploading(false);
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] }, maxFiles: 1,
  });

  if (imageUrl) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-slate-700 group">
        <img src={imageUrl} alt="preview" className="w-full max-h-48 object-cover" />
        <button
          onClick={onClear}
          className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={14} />
        </button>
        <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
          Imagen cargada
        </div>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        isDragActive ? 'border-primary-500 bg-primary-500/10' : 'border-slate-700 hover:border-slate-600'
      }`}
    >
      <input {...getInputProps()} />
      {uploading ? (
        <p className="text-slate-400 text-sm">Subiendo imagen...</p>
      ) : (
        <>
          <Upload size={28} className="mx-auto mb-2 text-slate-600" />
          <p className="text-sm text-slate-400">{isDragActive ? 'Suelta la imagen aquí' : 'Arrastra o haz clic para subir imagen'}</p>
          <p className="text-xs text-slate-600 mt-1">JPG, PNG, WEBP · máx 5MB</p>
        </>
      )}
    </div>
  );
}

// ── Preview estilo WhatsApp ───────────────────────────────────
function WAPreview({ text }) {
  const preview = (text || '')
    .replace(/\{nombre\}/g, 'Juan López')
    .replace(/\{ciudad\}/g, 'Bogotá')
    .replace(/\{categoria\}/g, 'restaurante')
    .replace(/\{website\}/g, 'www.ejemplo.com')
    .replace(/\{calificacion\}/g, '4.5')
    .replace(/\{score\}/g, '82')
    .replace(/\{(\w+)\|(\w+)\}/g, '$1');

  return (
    <div className="bg-[#0b141a] rounded-xl p-4">
      <p className="text-[10px] text-slate-500 mb-2 uppercase tracking-widest">Preview WhatsApp</p>
      <div className="flex justify-end">
        <div className="bg-[#005c4b] text-white text-sm rounded-xl rounded-tr-none px-3 py-2 max-w-[80%] leading-relaxed shadow-lg whitespace-pre-wrap">
          {preview || <span className="text-white/40 italic">Escribe un mensaje arriba...</span>}
          <div className="text-[10px] text-white/50 text-right mt-1">12:34 ✓✓</div>
        </div>
      </div>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────
export default function NewCampaignModal({ show, onClose, sessionId, onCreated, preSelectedProspects }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState('mensajes');
  const [sequences, setSequences] = useState([]);
  const [focusedMsg, setFocusedMsg] = useState({ isAb: false, abIdx: 0, msgIdx: 0 });
  const textareaRefs = useRef([]);
  const abRefs = useRef([]);

  useEffect(() => {
    if (show) {
      setForm(DEFAULT_FORM);
      setTab('mensajes');
      api.getSequences(sessionId).then(r => { if (r.success) setSequences(r.data); });
    }
  }, [show, sessionId]);

  const insertVariable = (variable) => {
    if (focusedMsg.isAb) {
      const el = abRefs.current[focusedMsg.abIdx];
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const msgs = [...form.abMessages];
      msgs[focusedMsg.abIdx] = msgs[focusedMsg.abIdx].slice(0, start) + variable + msgs[focusedMsg.abIdx].slice(end);
      setForm(f => ({ ...f, abMessages: msgs }));
      setTimeout(() => { el.focus(); el.setSelectionRange(start + variable.length, start + variable.length); }, 0);
    } else {
      const el = textareaRefs.current[focusedMsg.msgIdx];
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const msgs = [...form.messages];
      msgs[focusedMsg.msgIdx] = msgs[focusedMsg.msgIdx].slice(0, start) + variable + msgs[focusedMsg.msgIdx].slice(end);
      setForm(f => ({ ...f, messages: msgs }));
      setTimeout(() => { el.focus(); el.setSelectionRange(start + variable.length, start + variable.length); }, 0);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Escribe un nombre para la campaña'); return; }
    if (!form.abEnabled && !form.messages[0]?.trim()) { toast.error('Escribe al menos un mensaje'); return; }
    if (form.abEnabled && (!form.abMessages[0]?.trim() || !form.abMessages[1]?.trim())) {
      toast.error('Ambas variantes A/B requieren al menos un mensaje'); return;
    }
    setCreating(true);
    try {
      const payload = {
        name: form.name,
        messages: form.abEnabled ? form.abMessages.filter(m => m.trim()) : form.messages.filter(m => m.trim()),
        dailyLimit: form.limit,
        nicheFilter: form.niche || null,
        sessionId,
        scheduledAt: form.scheduledAt || null,
        targetIds: preSelectedProspects || null,
        imageUrl: form.imageUrl || null,
        imageCaption: form.imageCaption || null,
        abMessages: form.abEnabled ? JSON.stringify(form.abMessages.map(m => [m])) : null,
        sequenceId: form.sequenceId || null,
      };
      const res = await api.createCampaign(payload);
      if (res.success) {
        toast.success(form.scheduledAt ? '📅 Campaña programada' : '✅ Campaña creada');
        onClose();
        onCreated?.();
      } else toast.error(res.error || 'Error creando campaña');
    } finally { setCreating(false); }
  };

  const TABS = [
    { id: 'mensajes', label: 'Mensajes', icon: MessageSquare },
    { id: 'imagen',   label: 'Imagen',   icon: ImageIcon },
    { id: 'opciones', label: 'Opciones', icon: Settings2 },
  ];

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-dark-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="glass-panel w-full max-w-3xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh]"
          >
            {/* Header */}
            <div className="p-5 border-b border-slate-700/80 flex justify-between items-center bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-4">
                <h3 className="text-xl font-black text-white flex items-center gap-3">
                  <Zap className="text-primary-500" /> Creador de Campaña
                </h3>
                {preSelectedProspects?.length > 0 && (
                  <span className="px-3 py-1 bg-primary-500/20 text-primary-400 border border-primary-500/30 rounded-full text-[10px] font-black uppercase tracking-wider">
                    {preSelectedProspects.length} seleccionados
                  </span>
                )}
              </div>
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                <XCircle size={22} />
              </button>
            </div>

            {/* Nombre */}
            <div className="px-6 pt-5 shrink-0">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Nombre de la Campaña *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej. Promo Odontólogos Q3"
                    className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary-500 transition-all font-medium text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Límite Diario</label>
                  <input type="number" value={form.limit} onChange={e => setForm({ ...form, limit: parseInt(e.target.value) })}
                    className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary-500 transition-all font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4 shrink-0">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-bold transition-colors ${
                    tab === t.id
                      ? 'bg-slate-800 text-white border border-b-0 border-slate-700'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <t.icon size={14} /> {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-800/20 border-x border-slate-700">

              {/* TAB: Mensajes */}
              {tab === 'mensajes' && (
                <div className="p-6 space-y-5">
                  {/* Variables chips */}
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Variables — haz clic para insertar en el cursor</p>
                    <div className="flex flex-wrap gap-2">
                      {VARIABLES.map(v => (
                        <button
                          key={v.label}
                          onClick={() => insertVariable(v.label)}
                          title={v.desc}
                          className="px-2.5 py-1 bg-primary-500/15 hover:bg-primary-500/30 text-primary-300 border border-primary-500/20 rounded-full text-xs font-mono transition-colors"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* A/B Test toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <SplitSquareHorizontal size={16} className="text-violet-400" />
                      <span className="text-sm font-bold text-white">Test A/B</span>
                      <span className="text-xs text-slate-500">— divide prospectos 50/50 entre dos variantes</span>
                    </div>
                    <button
                      onClick={() => setForm(f => ({ ...f, abEnabled: !f.abEnabled }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.abEnabled ? 'bg-violet-600' : 'bg-slate-700'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.abEnabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {/* Messages or A/B blocks */}
                  {!form.abEnabled ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Secuencia de Mensajes</label>
                        <TemplatePicker onSelect={(msgs) => setForm({ ...form, messages: msgs })} />
                      </div>
                      <div className="space-y-3">
                        {form.messages.map((msg, idx) => (
                          <div key={idx} className="relative group">
                            <div className="absolute top-3 left-3 w-5 h-5 bg-slate-800 text-slate-400 rounded-full flex items-center justify-center text-[10px] font-bold border border-slate-700 z-10">{idx + 1}</div>
                            <textarea
                              ref={el => textareaRefs.current[idx] = el}
                              value={msg}
                              onChange={e => { const msgs = [...form.messages]; msgs[idx] = e.target.value; setForm(f => ({ ...f, messages: msgs })); }}
                              onFocus={() => setFocusedMsg({ isAb: false, msgIdx: idx })}
                              rows={3}
                              placeholder={`Mensaje ${idx + 1} de la secuencia...`}
                              className="w-full bg-dark-900 border border-slate-700 rounded-xl pl-11 pr-11 py-3 text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 transition-all font-mono text-sm resize-none placeholder:text-slate-600"
                            />
                            {form.messages.length > 1 && (
                              <button onClick={() => setForm(f => ({ ...f, messages: f.messages.filter((_, i) => i !== idx) }))}
                                className="absolute top-3 right-3 p-1.5 bg-red-500/10 text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20 z-10">
                                <XCircle size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setForm(f => ({ ...f, messages: [...f.messages, ''] }))}
                        className="w-full py-2.5 border-2 border-dashed border-slate-700 text-slate-400 rounded-xl font-bold flex items-center justify-center gap-2 hover:border-primary-500/50 hover:text-primary-400 transition-colors text-sm">
                        <Plus size={16} /> Añadir mensaje a la secuencia
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {['A', 'B'].map((variant, abIdx) => (
                        <div key={variant} className={`space-y-2 p-3 rounded-xl border ${abIdx === 0 ? 'border-blue-500/30 bg-blue-500/5' : 'border-violet-500/30 bg-violet-500/5'}`}>
                          <p className={`text-xs font-black uppercase tracking-widest ${abIdx === 0 ? 'text-blue-400' : 'text-violet-400'}`}>Variante {variant}</p>
                          <textarea
                            ref={el => abRefs.current[abIdx] = el}
                            value={form.abMessages[abIdx]}
                            onChange={e => { const ab = [...form.abMessages]; ab[abIdx] = e.target.value; setForm(f => ({ ...f, abMessages: ab })); }}
                            onFocus={() => setFocusedMsg({ isAb: true, abIdx })}
                            rows={4}
                            placeholder={`Mensaje variante ${variant}...`}
                            className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-primary-500 transition-all font-mono text-sm resize-none placeholder:text-slate-600"
                          />
                          <WAPreview text={form.abMessages[abIdx]} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* WA Preview (single message mode) */}
                  {!form.abEnabled && form.messages[0] && (
                    <WAPreview text={form.messages[0]} />
                  )}

                  {/* AI Assistant */}
                  <AIAssistant
                    compact
                    onUseVariant={(text) => {
                      if (form.abEnabled) {
                        const ab = [...form.abMessages];
                        ab[focusedMsg.abIdx] = text;
                        setForm(f => ({ ...f, abMessages: ab }));
                      } else {
                        const msgs = [...form.messages];
                        msgs[focusedMsg.msgIdx] = text;
                        setForm(f => ({ ...f, messages: msgs }));
                      }
                    }}
                  />
                </div>
              )}

              {/* TAB: Imagen */}
              {tab === 'imagen' && (
                <div className="p-6 space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Imagen adjunta (opcional)</label>
                    <p className="text-xs text-slate-500 mb-4">La imagen se enviará junto con el mensaje en WhatsApp. Útil para flyers, portafolios, catálogos.</p>
                    <ImageDropzone
                      imageUrl={form.imageUrl}
                      onUpload={(url) => setForm(f => ({ ...f, imageUrl: url }))}
                      onClear={() => setForm(f => ({ ...f, imageUrl: '' }))}
                    />
                  </div>

                  {form.imageUrl && (
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Caption de la imagen</label>
                      <textarea
                        value={form.imageCaption}
                        onChange={e => setForm(f => ({ ...f, imageCaption: e.target.value }))}
                        placeholder="Texto que acompaña la imagen (opcional)..."
                        rows={3}
                        className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500 transition-all font-mono text-sm resize-none placeholder:text-slate-600"
                      />
                      <p className="text-xs text-slate-600">Si hay caption, el mensaje principal se ignora y se usa el caption como texto adjunto.</p>
                    </div>
                  )}

                  {!form.imageUrl && (
                    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 text-center">
                      <ImageIcon size={32} className="mx-auto mb-2 text-slate-600" />
                      <p className="text-sm text-slate-500">Sin imagen · se enviará solo texto</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: Opciones */}
              {tab === 'opciones' && (
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Filtro de Nicho</label>
                      <input value={form.niche} onChange={e => setForm({ ...form, niche: e.target.value })}
                        placeholder={preSelectedProspects ? 'Filtrado por selección' : 'Ej. Salud (opcional)'}
                        disabled={!!preSelectedProspects}
                        className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary-500 transition-all text-sm disabled:opacity-50"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <GitBranch size={11} /> Secuencia de Follow-up
                      </label>
                      <select
                        value={form.sequenceId}
                        onChange={e => setForm(f => ({ ...f, sequenceId: e.target.value }))}
                        className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary-500 transition-all text-sm"
                      >
                        <option value="">Sin secuencia</option>
                        {sequences.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {form.sequenceId && (
                        <p className="text-xs text-violet-400">Se enviarán mensajes de seguimiento automáticos a prospectos sin respuesta</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Calendar size={12} /> Programar Inicio (Opcional)
                    </label>
                    <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })}
                      className="w-full bg-dark-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary-500 transition-all text-sm"
                    />
                    {form.scheduledAt && (
                      <p className="text-xs text-orange-400 flex items-center gap-1">
                        <Calendar size={10} /> La campaña se lanzará automáticamente en la fecha programada
                      </p>
                    )}
                  </div>

                  <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                    <p className="text-sm font-bold text-white mb-2 flex items-center gap-2"><CheckCircle2 className="text-green-400" size={14}/> Sistema Anti-Ban V2 Activo</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 font-mono">
                      <span>• Intervalo base: <span className="text-primary-400">180–240s</span></span>
                      <span>• Entre mensajes: <span className="text-primary-400">25–35s</span></span>
                      <span>• Lotes de: <span className="text-primary-400">5 envíos</span></span>
                      <span>• Pausa lote: <span className="text-primary-400">15–20 min</span></span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-700/80 bg-slate-800/30 flex justify-end gap-3 shrink-0">
              <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-slate-300 hover:bg-slate-700 transition-colors text-sm">Cancelar</button>
              <button onClick={handleCreate} disabled={creating}
                className="px-7 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:bg-slate-700 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] active:scale-95 flex items-center gap-2 text-sm"
              >
                {form.scheduledAt ? <><Calendar size={16}/> Programar</> : <><Play size={16} fill="currentColor"/> Crear Campaña</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
