import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Search, CheckCircle2, XCircle, Loader2, Eye, EyeOff,
         Users, Hash, MapPin, Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

const PRESET_NICHES = [
  'restaurante', 'salón de belleza', 'peluquería', 'tienda de ropa',
  'dentista', 'gimnasio', 'panadería', 'cafetería', 'hotel', 'spa',
  'clínica', 'veterinaria', 'ferretería', 'joyería', 'florería',
  'consultorio médico', 'agencia de viajes', 'inmobiliaria',
];

const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena',
                'Bucaramanga', 'Pereira', 'Manizales', 'Cúcuta', 'Ibagué'];

// ── Config section ────────────────────────────────────────────
function IGConfig({ onSaved }) {
  const [token,  setToken]  = useState('');
  const [userId, setUserId] = useState('');
  const [show,   setShow]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    api.getIGSettings().then(r => {
      if (r.success) {
        setUserId(r.userId || '');
        if (r.hasToken) setToken('••••••••••••••••');
      }
    });
  }, []);

  const handleSave = async () => {
    if (!token || token.startsWith('•') || !userId) {
      toast.error('Completa el Access Token y el User ID');
      return;
    }
    setSaving(true);
    const r = await api.saveIGSettings({ accessToken: token, userId });
    if (r.success) {
      toast.success('Credenciales guardadas');
      onSaved?.();
    } else toast.error(r.error || 'Error guardando');
    setSaving(false);
  };

  const handleVerify = async () => {
    setVerifying(true);
    setAccount(null);
    const r = await api.verifyIGCredentials();
    if (r.success) {
      setAccount(r.account);
      toast.success(`Conectado como @${r.account.username}`);
    } else toast.error(r.error || 'Error verificando');
    setVerifying(false);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-pink-500/10 border border-violet-500/20">
        <p className="text-xs text-violet-300 font-medium leading-relaxed">
          Necesitas una cuenta de Instagram Business conectada a una página de Facebook,
          y un App de Meta Developers con permisos <span className="font-mono text-pink-300">instagram_basic</span> y <span className="font-mono text-pink-300">pages_read_engagement</span>.
          {' '}<a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer"
             className="underline text-violet-400 hover:text-violet-300 inline-flex items-center gap-1">
            developers.facebook.com <ExternalLink size={10} />
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
            Page Access Token (long-lived)
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type={show ? 'text' : 'password'}
                value={token}
                onFocus={() => { if (token.startsWith('•')) setToken(''); }}
                onChange={e => setToken(e.target.value)}
                placeholder="EAABs..."
                className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-violet-500 outline-none text-sm font-mono pr-10"
              />
              <button onClick={() => setShow(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
            IG Business Account ID (tu cuenta)
          </label>
          <input
            type="text"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="17841400008460056"
            className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-violet-500 outline-none text-sm font-mono"
          />
          <p className="text-[10px] text-slate-600">
            Encuéntralo en: Graph API Explorer → /me?fields=id,username → con tu token
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Guardar credenciales
        </button>
        <button onClick={handleVerify} disabled={verifying}
          className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 hover:text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
          {verifying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Verificar
        </button>
      </div>

      {account && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
          <div>
            <p className="text-sm font-bold text-green-400">@{account.username}</p>
            <p className="text-xs text-slate-500">{account.name} · {account.account_type}</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ── Search form ───────────────────────────────────────────────
function IGSearchForm({ sessionId, onComplete }) {
  const [niche,   setNiche]   = useState('');
  const [city,    setCity]    = useState('Bogotá');
  const [limit,   setLimit]   = useState(60);
  const [extra,   setExtra]   = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    // Escuchar progreso vía socket
    const handler = (e) => setProgress(e.detail);
    window.addEventListener(`ig-progress-${sessionId}`, handler);
    return () => window.removeEventListener(`ig-progress-${sessionId}`, handler);
  }, [sessionId]);

  const handleSearch = async () => {
    if (!niche.trim()) { toast.error('Escribe el tipo de negocio'); return; }
    setLoading(true);
    setProgress({ pct: 0, text: 'Iniciando búsqueda en Instagram...' });

    const customHashtags = extra.split(',').map(h => h.trim().replace(/^#/, '')).filter(Boolean);
    const r = await api.searchInstagram({ niche, city, limit, customHashtags, sessionId });

    if (r.success) {
      toast.success(`✅ ${r.imported} prospectos importados de Instagram`);
      onComplete?.();
    } else {
      toast.error(r.error || 'Error en la búsqueda');
    }
    setLoading(false);
    setProgress(null);
  };

  return (
    <div className="space-y-5">
      {/* Niche */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
          Tipo de negocio / Nicho *
        </label>
        <input
          value={niche}
          onChange={e => setNiche(e.target.value)}
          placeholder="ej: restaurante, salón de belleza, dentista..."
          className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-pink-500 outline-none text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESET_NICHES.map(n => (
            <button key={n} onClick={() => setNiche(n)}
              className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                niche === n
                  ? 'bg-pink-500/30 text-pink-300 border border-pink-500/40'
                  : 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700'
              }`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* City */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block flex items-center gap-1">
            <MapPin size={10} /> Ciudad
          </label>
          <select value={city} onChange={e => setCity(e.target.value)}
            className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-pink-500 outline-none text-sm">
            {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Limit */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block flex items-center gap-1">
            <Users size={10} /> Máx prospectos
          </label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-pink-500 outline-none text-sm">
            {[30, 60, 100, 150, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Extra hashtags */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block flex items-center gap-1">
          <Hash size={10} /> Hashtags adicionales (opcional, separados por coma)
        </label>
        <input
          value={extra}
          onChange={e => setExtra(e.target.value)}
          placeholder="#salonbogota, #bellezacali, #estetica..."
          className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:border-pink-500 outline-none text-sm"
        />
      </div>

      {/* Progress */}
      <AnimatePresence>
        {progress && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-2">
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full transition-all duration-500"
                   style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="text-xs text-slate-400 font-mono">{progress.text}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <button onClick={handleSearch} disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all">
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Buscando en Instagram...</>
          : <><Camera size={16} /> Buscar negocios en Instagram</>
        }
      </button>

      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { icon: Hash,     label: 'Hasta 6 hashtags', desc: 'por búsqueda' },
          { icon: Users,    label: 'Business Discovery', desc: 'API oficial' },
          { icon: Sparkles, label: 'Score automático', desc: 'followers + contacto' },
        ].map(item => (
          <div key={item.label} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/50">
            <item.icon size={16} className="mx-auto mb-1 text-pink-400" />
            <p className="text-[10px] font-bold text-slate-300">{item.label}</p>
            <p className="text-[9px] text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function InstagramSearch({ sessionId, onProspectsImported }) {
  const [tab, setTab]         = useState('search');
  const [hasConfig, setHasConfig] = useState(false);

  useEffect(() => {
    api.getIGSettings().then(r => {
      if (r.success && r.hasToken && r.hasUserId) setHasConfig(true);
    });
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-violet-500/20 to-pink-500/20 rounded-xl border border-violet-500/20">
          <Camera size={20} className="text-pink-400" />
        </div>
        <div>
          <h4 className="font-black text-white">Instagram Graph API</h4>
          <p className="text-xs text-slate-500">Prospecta negocios directamente desde Instagram</p>
        </div>
        {hasConfig && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-full font-bold">
            <CheckCircle2 size={10} /> Configurado
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {[
          { id: 'search', label: 'Buscar' },
          { id: 'config', label: 'Configurar API' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              tab === t.id ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {!hasConfig && tab === 'search' && (
        <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300">
            Primero configura tus credenciales de Instagram API en la pestaña <strong>Configurar API</strong>.
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === 'search' && (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <IGSearchForm sessionId={sessionId} onComplete={onProspectsImported} />
          </motion.div>
        )}
        {tab === 'config' && (
          <motion.div key="config" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <IGConfig onSaved={() => { setHasConfig(true); setTab('search'); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
