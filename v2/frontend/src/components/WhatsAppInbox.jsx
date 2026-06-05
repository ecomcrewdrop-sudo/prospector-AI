import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, ArrowLeft, RefreshCw, User } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import socket from '../lib/socket';

function timeSince(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function WhatsAppInbox({ sessionId }) {
  const [conversations, setConvos] = useState([]);
  const [selected, setSelected]    = useState(null);
  const [messages, setMessages]    = useState([]);
  const [loading, setLoading]      = useState(false);
  const bottomRef    = useRef();
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId; // siempre actualizado en cada render

  const fetchConvos = async () => {
    const snap = sessionIdRef.current;
    const res = await api.getReplies(snap);
    if (snap !== sessionIdRef.current) return; // respuesta obsoleta — descartar
    if (res.success) setConvos(res.data);
  };

  const openConvo = async (phone) => {
    setSelected(phone);
    setLoading(true);
    const snap = sessionIdRef.current;
    try {
      const res = await api.getConversation(snap, phone);
      if (snap !== sessionIdRef.current) return; // sesión cambió durante el fetch
      if (res.success) setMessages(res.data);
    } finally {
      if (snap === sessionIdRef.current) setLoading(false);
    }
  };

  // Al cambiar de sesión: limpiar inbox anterior de inmediato
  useEffect(() => {
    setConvos([]);
    setSelected(null);
    setMessages([]);
    fetchConvos();
  }, [sessionId]);

  useEffect(() => {
    const handler = (data) => {
      fetchConvos();
      if (selected === data.phone) {
        setMessages(prev => [...prev, { message: data.message, timestamp: new Date().toISOString(), fromPhone: data.phone }]);
      }
    };
    socket.on(`wa:reply:${sessionId}`, handler);
    return () => socket.off(`wa:reply:${sessionId}`, handler);
  }, [sessionId, selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedConvo = conversations.find(c => c.fromPhone === selected);

  return (
    <motion.div key="inbox" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="glass-panel flex overflow-hidden bg-dark-800/40 border border-slate-700/50" style={{ height: 'calc(100vh - 180px)' }}
    >
      {/* Conversation list */}
      <div className={clsx('flex flex-col border-r border-slate-700/50', selected ? 'hidden md:flex md:w-72 lg:w-80' : 'flex flex-1 md:w-72 lg:w-80')}>
        <div className="p-4 border-b border-slate-700/50 bg-slate-900/40 flex items-center justify-between">
          <h3 className="font-black text-white flex items-center gap-2 text-base">
            <MessageCircle size={18} className="text-primary-400" /> Inbox WA
          </h3>
          <button onClick={fetchConvos} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 text-sm p-8 text-center">
              <MessageCircle size={40} className="mb-3 opacity-20" />
              <p className="font-bold text-slate-400">Sin respuestas aún</p>
              <p className="text-xs mt-1">Los mensajes entrantes de WhatsApp aparecerán aquí.</p>
            </div>
          ) : (
            conversations.map(c => (
              <button key={c.fromPhone} onClick={() => openConvo(c.fromPhone)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-slate-700/30 transition-colors',
                  selected === c.fromPhone ? 'bg-primary-500/10 border-l-2 border-l-primary-500' : 'hover:bg-slate-800/50'
                )}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-600/30 to-primary-800/50 flex items-center justify-center shrink-0 font-bold text-primary-400 text-sm">
                  {(c.prospectName || c.fromPhone).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-200 text-sm truncate">{c.prospectName || `+${c.fromPhone}`}</p>
                    <span className="text-[10px] text-slate-500 shrink-0 ml-1">{timeSince(c.lastTime)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{c.lastMessage}</p>
                </div>
                {c.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] bg-primary-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 shrink-0">
                    {c.unread}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat view */}
      <div className={clsx('flex flex-col flex-1', !selected && 'hidden md:flex')}>
        {selected && selectedConvo ? (
          <>
            {/* Chat header */}
            <div className="px-5 py-4 border-b border-slate-700/50 bg-slate-900/40 flex items-center gap-3">
              <button onClick={() => { setSelected(null); setMessages([]); }} className="md:hidden p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                <ArrowLeft size={18} />
              </button>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-600/30 to-primary-800/50 flex items-center justify-center font-bold text-primary-400 text-sm shrink-0">
                {(selectedConvo.prospectName || selectedConvo.fromPhone).charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-white text-sm">{selectedConvo.prospectName || `+${selectedConvo.fromPhone}`}</p>
                <p className="text-[10px] text-slate-500">+{selectedConvo.fromPhone} · {selectedConvo.msgCount} mensajes</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar bg-dark-900/30">
              {loading ? (
                <div className="flex items-center justify-center h-full text-slate-500">Cargando mensajes...</div>
              ) : messages.map((m, i) => (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tl-sm bg-slate-800 border border-slate-700/50 shadow-sm">
                    <p className="text-sm text-slate-200 break-words">{m.message}</p>
                    <p className="text-[10px] text-slate-500 mt-1 text-right">{m.timestamp ? new Date(m.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
              <p className="text-xs text-slate-600 text-center">Los mensajes salientes se gestionan desde las Campañas</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
            <MessageCircle size={56} className="mb-4 opacity-10" />
            <p className="font-bold text-slate-400 text-lg">Selecciona una conversación</p>
            <p className="text-sm mt-1 text-slate-500">Las respuestas de tus prospectos aparecen aquí</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
