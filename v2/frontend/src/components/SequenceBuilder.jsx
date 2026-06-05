import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ChevronDown, Clock, MessageSquare, Save, X } from 'lucide-react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const emptyStep = () => ({ delayDays: 3, messages: [''] });

function StepEditor({ step, idx, onChange, onDelete }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 border border-slate-700 rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-xs font-black text-white">
            {idx + 1}
          </div>
          <span className="font-bold text-sm text-white">Paso {idx + 1}</span>
        </div>
        <button onClick={onDelete} className="text-slate-600 hover:text-red-400 transition-colors p-1">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-slate-400 shrink-0" />
        <span className="text-sm text-slate-400">Enviar</span>
        <input
          type="number"
          min={1}
          max={30}
          value={step.delayDays}
          onChange={e => onChange({ ...step, delayDays: parseInt(e.target.value) || 1 })}
          className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-primary-500"
        />
        <span className="text-sm text-slate-400">día(s) después del contacto inicial</span>
      </div>

      <div className="space-y-2">
        {step.messages.map((msg, mIdx) => (
          <div key={mIdx} className="flex gap-2">
            <textarea
              value={msg}
              onChange={e => {
                const msgs = [...step.messages];
                msgs[mIdx] = e.target.value;
                onChange({ ...step, messages: msgs });
              }}
              placeholder={`Mensaje ${mIdx + 1} — puedes usar {nombre}, {ciudad}, {categoria}...`}
              rows={3}
              className="flex-1 bg-slate-700/60 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none"
            />
            {step.messages.length > 1 && (
              <button
                onClick={() => {
                  const msgs = step.messages.filter((_, i) => i !== mIdx);
                  onChange({ ...step, messages: msgs });
                }}
                className="text-slate-600 hover:text-red-400 transition-colors self-start mt-2"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => onChange({ ...step, messages: [...step.messages, ''] })}
          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors"
        >
          <Plus size={12} /> Agregar mensaje a esta secuencia
        </button>
      </div>
    </motion.div>
  );
}

export default function SequenceBuilder({ sessionId, onClose }) {
  const [sequences, setSequences]   = useState([]);
  const [editing, setEditing]       = useState(null); // { id?, name, steps[] }
  const [loading, setLoading]       = useState(false);

  const load = async () => {
    const res = await api.getSequences(sessionId);
    if (res.success) setSequences(res.data);
  };

  useEffect(() => { load(); }, [sessionId]);

  const startNew = () => setEditing({ name: '', steps: [emptyStep()] });
  const startEdit = (seq) => setEditing({
    id: seq.id,
    name: seq.name,
    steps: JSON.parse(seq.steps),
  });

  const handleSave = async () => {
    if (!editing.name.trim()) { toast.error('Nombre requerido'); return; }
    if (!editing.steps.length) { toast.error('Agrega al menos un paso'); return; }
    const invalid = editing.steps.some(s => !s.messages.some(m => m.trim()));
    if (invalid) { toast.error('Todos los pasos deben tener al menos un mensaje'); return; }

    setLoading(true);
    try {
      let res;
      if (editing.id) {
        res = await api.updateSequence(editing.id, { name: editing.name, steps: editing.steps });
      } else {
        res = await api.createSequence({ name: editing.name, steps: editing.steps, sessionId });
      }
      if (res.success) {
        toast.success(editing.id ? 'Secuencia actualizada' : 'Secuencia creada');
        setEditing(null);
        await load();
      } else {
        toast.error(res.error || 'Error guardando');
      }
    } catch { toast.error('Error de red'); }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta secuencia?')) return;
    await api.deleteSequence(id);
    await load();
    toast.success('Secuencia eliminada');
  };

  const handleToggle = async (seq) => {
    await api.updateSequence(seq.id, { isActive: !seq.isActive });
    await load();
  };

  return (
    <div className="space-y-4">
      {/* Lista */}
      {!editing && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white">Secuencias de Follow-up</h3>
            <button
              onClick={startNew}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors"
            >
              <Plus size={14} /> Nueva secuencia
            </button>
          </div>

          {sequences.length === 0 && (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
              <MessageSquare size={32} className="mx-auto mb-2 opacity-40" />
              <p>Sin secuencias creadas</p>
              <p className="text-xs mt-1">Las secuencias envían mensajes automáticos de seguimiento a prospectos sin respuesta</p>
            </div>
          )}

          {sequences.map(seq => {
            const steps = JSON.parse(seq.steps || '[]');
            return (
              <div key={seq.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold text-white text-sm">{seq.name}</p>
                    <p className="text-xs text-slate-400">{steps.length} paso(s) · {steps.map(s => `día ${s.delayDays}`).join(' → ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(seq)}
                      className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
                        seq.isActive ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'
                      }`}
                    >
                      {seq.isActive ? 'Activa' : 'Pausada'}
                    </button>
                    <button onClick={() => startEdit(seq)} className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors">Editar</button>
                    <button onClick={() => handleDelete(seq.id)} className="text-slate-600 hover:text-red-400 transition-colors p-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Editor */}
      {editing && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white">{editing.id ? 'Editar' : 'Nueva'} Secuencia</h3>
            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>

          <input
            value={editing.name}
            onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
            placeholder="Nombre de la secuencia..."
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
          />

          {/* Timeline visual */}
          <div className="relative">
            {editing.steps.map((step, idx) => (
              <div key={idx} className="relative">
                {idx > 0 && (
                  <div className="absolute left-3.5 -top-3 w-0.5 h-3 bg-slate-700" />
                )}
                <StepEditor
                  step={step}
                  idx={idx}
                  onChange={updated => {
                    const steps = [...editing.steps];
                    steps[idx] = updated;
                    setEditing(ed => ({ ...ed, steps }));
                  }}
                  onDelete={() => {
                    const steps = editing.steps.filter((_, i) => i !== idx);
                    setEditing(ed => ({ ...ed, steps }));
                  }}
                />
                {idx < editing.steps.length - 1 && <div className="h-3" />}
              </div>
            ))}
          </div>

          <button
            onClick={() => setEditing(ed => ({ ...ed, steps: [...ed.steps, emptyStep()] }))}
            className="w-full py-2 border border-dashed border-slate-600 hover:border-primary-500 text-slate-400 hover:text-primary-400 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={14} /> Agregar paso
          </button>

          <div className="flex gap-2">
            <button onClick={() => setEditing(null)} className="flex-1 py-2 border border-slate-700 text-slate-400 hover:text-white rounded-xl text-sm font-bold transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Save size={14} /> {loading ? 'Guardando...' : 'Guardar secuencia'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
