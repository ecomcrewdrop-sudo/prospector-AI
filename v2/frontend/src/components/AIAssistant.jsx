import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Copy, Check, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const TONES = [
  { id: 'profesional', label: '💼 Profesional', desc: 'Formal y directo' },
  { id: 'amigable',    label: '😊 Amigable',    desc: 'Cálido y cercano' },
  { id: 'consultivo',  label: '🎯 Consultivo',   desc: 'Aporta valor' },
  { id: 'urgente',     label: '⚡ Urgente',      desc: 'Con sentido de oportunidad' },
];

export default function AIAssistant({ onUseVariant, compact = false }) {
  const [form, setForm]           = useState({ category: '', city: '', tone: 'profesional', hasWebsite: false });
  const [variants, setVariants]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState(null);
  const [open, setOpen]           = useState(!compact);

  const handleGenerate = async () => {
    if (!form.category.trim()) { toast.error('Escribe el tipo de negocio'); return; }
    setLoading(true);
    setVariants([]);
    try {
      const res = await api.aiGenerate({
        category:   form.category,
        city:       form.city,
        tone:       form.tone,
        hasWebsite: form.hasWebsite,
        count:      3,
      });
      if (res.success) {
        setVariants(res.variants);
      } else {
        toast.error(res.error || 'Error generando mensajes');
      }
    } catch {
      toast.error('Error conectando con la IA');
    }
    setLoading(false);
  };

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  };

  const panel = (
    <div className="space-y-4">
      {/* Form */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-slate-400 font-medium block mb-1">Tipo de negocio / Nicho *</label>
          <input
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            placeholder="ej: restaurante, salón de belleza, dentista..."
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1">Ciudad / Región</label>
          <input
            value={form.city}
            onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
            placeholder="ej: Bogotá, Medellín..."
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 font-medium block mb-1">¿Tiene sitio web?</label>
          <div className="flex gap-2 mt-1">
            {[{ v: false, l: 'No' }, { v: true, l: 'Sí' }].map(opt => (
              <button
                key={String(opt.v)}
                onClick={() => setForm(f => ({ ...f, hasWebsite: opt.v }))}
                className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-colors ${
                  form.hasWebsite === opt.v
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tone selector */}
      <div>
        <label className="text-xs text-slate-400 font-medium block mb-2">Tono del mensaje</label>
        <div className="grid grid-cols-2 gap-2">
          {TONES.map(tone => (
            <button
              key={tone.id}
              onClick={() => setForm(f => ({ ...f, tone: tone.id }))}
              className={`p-2.5 rounded-xl text-left transition-colors border ${
                form.tone === tone.id
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              }`}
            >
              <p className="text-sm font-bold text-white">{tone.label}</p>
              <p className="text-xs text-slate-500">{tone.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-primary-600 hover:from-violet-500 hover:to-primary-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? 'Generando con IA...' : 'Generar mensajes con IA'}
      </button>

      {/* Variants */}
      <AnimatePresence>
        {variants.map((variant, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
            className="bg-slate-800/60 border border-slate-700 rounded-xl p-4"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-slate-400">{variant.label}</span>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => handleCopy(variant.text, idx)}
                  className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                  title="Copiar"
                >
                  {copied === idx ? <Check size={13} className="text-green-400" /> : <Copy size={13} className="text-slate-400" />}
                </button>
                {onUseVariant && (
                  <button
                    onClick={() => { onUseVariant(variant.text); toast.success('Mensaje insertado'); }}
                    className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-bold transition-colors"
                  >
                    Usar
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-white leading-relaxed">{variant.text}</p>
          </motion.div>
        ))}
      </AnimatePresence>

      {variants.length > 0 && (
        <button
          onClick={handleGenerate}
          className="w-full py-2 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <RefreshCw size={14} /> Regenerar variantes
        </button>
      )}
    </div>
  );

  if (!compact) return panel;

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-400" />
          <span className="font-bold text-sm text-white">Asistente IA — Generar mensajes</span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-slate-700">{panel}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
