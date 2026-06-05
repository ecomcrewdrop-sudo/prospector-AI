import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Globe, Camera, MapPin, Star, Tag, Plus, Trash2, MessageCircle, Activity, StickyNote, Info, ExternalLink, Edit3, Check } from 'lucide-react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const STAGES = [
  { id: 'new',          label: 'Nuevo',       color: 'bg-slate-500' },
  { id: 'contacted',    label: 'Contactado',  color: 'bg-blue-500' },
  { id: 'replied',      label: 'Respondió',   color: 'bg-yellow-500' },
  { id: 'interested',   label: 'Interesado',  color: 'bg-orange-500' },
  { id: 'negotiating',  label: 'Negociando',  color: 'bg-purple-500' },
  { id: 'won',          label: 'Ganado',      color: 'bg-green-500' },
  { id: 'lost',         label: 'Perdido',     color: 'bg-red-500' },
];

const ACTIVITY_ICONS = {
  message_sent:   { icon: MessageCircle, color: 'text-blue-400',   label: 'Mensaje enviado' },
  reply:          { icon: MessageCircle, color: 'text-green-400',  label: 'Respuesta recibida' },
  stage_changed:  { icon: Activity,      color: 'text-yellow-400', label: 'Etapa cambiada' },
  note:           { icon: StickyNote,    color: 'text-purple-400', label: 'Nota añadida' },
  followup_sent:  { icon: MessageCircle, color: 'text-orange-400', label: 'Follow-up enviado' },
};

export default function ProspectDrawer({ prospect, sessionId, onClose, onStageChange }) {
  const [activeTab, setActiveTab]     = useState('info');
  const [notes, setNotes]             = useState([]);
  const [activities, setActivities]   = useState([]);
  const [conversation, setConversation] = useState([]);
  const [newNote, setNewNote]         = useState('');
  const [newTag, setNewTag]           = useState('');
  const [tags, setTags]               = useState([]);
  const [stage, setStage]             = useState(prospect?.stage || 'new');
  const [loadingNote, setLoadingNote] = useState(false);
  const [editingField, setEditingField] = useState(null);

  const pid = prospect?.id;

  const loadData = useCallback(async () => {
    if (!pid) return;
    const [notesRes, actRes, convRes] = await Promise.all([
      api.getProspectNotes(pid),
      api.getProspectActivity(pid),
      api.getConversation(sessionId, prospect.phone),
    ]);
    if (notesRes.success) setNotes(notesRes.data);
    if (actRes.success)   setActivities(actRes.data);
    if (convRes.success)  setConversation(convRes.data);
  }, [pid, sessionId, prospect?.phone]);

  useEffect(() => {
    if (!prospect) return;
    setStage(prospect.stage || 'new');
    setTags(prospect.tags ? JSON.parse(prospect.tags) : []);
    setNotes([]);
    setActivities([]);
    setConversation([]);
    setActiveTab('info');
    loadData();
  }, [prospect?.id]);

  useEffect(() => {
    if (activeTab === 'notes' || activeTab === 'activity' || activeTab === 'conversation') {
      loadData();
    }
  }, [activeTab]);

  if (!prospect) return null;

  const handleStageChange = async (newStage) => {
    setStage(newStage);
    const res = await api.updateProspectStage(pid, newStage, sessionId);
    if (res.success) {
      toast.success(`Etapa actualizada: ${STAGES.find(s => s.id === newStage)?.label}`);
      onStageChange?.(pid, newStage);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setLoadingNote(true);
    const res = await api.addProspectNote(pid, newNote.trim(), sessionId);
    if (res.success) {
      setNewNote('');
      await loadData();
      toast.success('Nota guardada');
    }
    setLoadingNote(false);
  };

  const handleDeleteNote = async (noteId) => {
    await api.deleteProspectNote(pid, noteId);
    setNotes(n => n.filter(x => x.id !== noteId));
  };

  const handleAddTag = async () => {
    const t = newTag.trim().toLowerCase();
    if (!t || tags.includes(t)) { setNewTag(''); return; }
    const newTags = [...tags, t];
    setTags(newTags);
    setNewTag('');
    await api.updateProspectTags(pid, newTags, sessionId);
  };

  const handleRemoveTag = async (tag) => {
    const newTags = tags.filter(t => t !== tag);
    setTags(newTags);
    await api.updateProspectTags(pid, newTags, sessionId);
  };

  const currentStage = STAGES.find(s => s.id === stage) || STAGES[0];
  const scoreColor = prospect.score >= 80 ? 'text-green-400' : prospect.score >= 60 ? 'text-yellow-400' : 'text-slate-400';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 h-full w-[420px] bg-dark-900 border-l border-slate-800 z-50 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-lg text-white truncate">{prospect.name}</h3>
            <p className="text-slate-400 text-sm">{prospect.niche || 'Sin categoría'} · {prospect.city || '—'}</p>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span className={`text-2xl font-black ${scoreColor}`}>{prospect.score}</span>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors">
              <X size={18} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Stage selector */}
        <div className="px-5 py-3 border-b border-slate-800">
          <p className="text-xs text-slate-500 uppercase font-bold mb-2">Etapa CRM</p>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map(s => (
              <button
                key={s.id}
                onClick={() => handleStageChange(s.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  stage === s.id
                    ? `${s.color} text-white shadow-lg`
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="px-5 py-3 border-b border-slate-800">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 bg-primary-500/20 text-primary-300 px-2 py-0.5 rounded-full text-xs font-medium">
                #{tag}
                <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-400 ml-0.5">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTag()}
              placeholder="Agregar etiqueta..."
              className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
            />
            <button onClick={handleAddTag} className="px-2.5 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-bold">
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800">
          {[
            { id: 'info',         icon: Info,            label: 'Info' },
            { id: 'notes',        icon: StickyNote,      label: 'Notas' },
            { id: 'activity',     icon: Activity,        label: 'Actividad' },
            { id: 'conversation', icon: MessageCircle,   label: 'Chat WA' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-bold transition-colors ${
                activeTab === tab.id
                  ? 'text-primary-400 border-b-2 border-primary-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          {activeTab === 'info' && (
            <div className="space-y-3">
              <InfoRow icon={Phone}     label="Teléfono"  value={prospect.phone}     link={`tel:${prospect.phone}`} />
              <InfoRow icon={Globe}     label="Website"   value={prospect.website}   link={prospect.website} external />
              <InfoRow icon={Camera} label="Instagram" value={prospect.instagram} link={prospect.instagram ? `https://instagram.com/${prospect.instagram.replace('@','')}` : null} external />
              <InfoRow icon={MapPin}    label="Dirección" value={prospect.address} />
              <InfoRow icon={Star}      label="Rating"    value={prospect.rating ? `${prospect.rating} ⭐ (${prospect.reviews} reseñas)` : '—'} />

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Score"   value={prospect.score} color={scoreColor} />
                <Stat label="Fuente"  value={prospect.source || '—'} />
                <Stat label="Estado"  value={prospect.status || '—'} />
                <Stat label="Creado"  value={prospect.createdAt ? new Date(prospect.createdAt).toLocaleDateString('es-CO') : '—'} />
              </div>

              <div className="mt-4 flex gap-2">
                {prospect.phone && (
                  <a
                    href={`https://wa.me/${String(prospect.phone).replace(/\D/g,'')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    <MessageCircle size={16} /> Abrir WA
                  </a>
                )}
                {prospect.website && (
                  <a
                    href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-colors"
                  >
                    <ExternalLink size={16} /> Web
                  </a>
                )}
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Escribe una nota sobre este prospecto..."
                  rows={3}
                  className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none"
                />
              </div>
              <button
                onClick={handleAddNote}
                disabled={loadingNote || !newNote.trim()}
                className="w-full py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-colors"
              >
                {loadingNote ? 'Guardando...' : 'Guardar nota'}
              </button>

              <div className="space-y-2 mt-2">
                {notes.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-4">Sin notas aún</p>
                )}
                {notes.map(note => (
                  <div key={note.id} className="bg-slate-800/50 rounded-xl p-3 border border-slate-700">
                    <p className="text-sm text-white">{note.content}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleString('es-CO')}</span>
                      <button onClick={() => handleDeleteNote(note.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-2">
              {activities.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">Sin actividad registrada</p>
              )}
              {activities.map(act => {
                const cfg = ACTIVITY_ICONS[act.type] || ACTIVITY_ICONS.message_sent;
                const data = act.data ? JSON.parse(act.data) : {};
                return (
                  <div key={act.id} className="flex gap-3 items-start">
                    <div className={`w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center shrink-0 mt-0.5`}>
                      <cfg.icon size={12} className={cfg.color} />
                    </div>
                    <div>
                      <p className="text-sm text-white">{cfg.label}{data.campaignName ? ` · ${data.campaignName}` : ''}{data.stage ? ` → ${STAGES.find(s=>s.id===data.stage)?.label}` : ''}</p>
                      <p className="text-xs text-slate-500">{new Date(act.createdAt).toLocaleString('es-CO')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'conversation' && (
            <div className="space-y-2">
              {conversation.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">Sin mensajes registrados en el inbox</p>
              )}
              {conversation.map(msg => (
                <div key={msg.id} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                  <p className="text-sm text-white">{msg.message}</p>
                  <p className="text-xs text-slate-500 mt-1">{new Date(msg.timestamp).toLocaleString('es-CO')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
    </AnimatePresence>
  );
}

function InfoRow({ icon: Icon, label, value, link, external }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon size={15} className="text-slate-500 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        {link ? (
          <a href={link} target={external ? '_blank' : undefined} rel="noopener noreferrer"
             className="text-sm text-primary-400 hover:underline break-all">
            {value}
          </a>
        ) : (
          <p className="text-sm text-white break-all">{value}</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-800/50 rounded-xl p-3">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}
