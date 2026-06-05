import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';

import { api } from './lib/api';
import socket from './lib/socket';

import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ProspectsTable from './components/ProspectsTable';
import SearchPanel from './components/SearchPanel';
import CampaignGrid from './components/CampaignGrid';
import NewCampaignModal from './components/NewCampaignModal';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import WhatsAppInbox from './components/WhatsAppInbox';
import SettingsPanel from './components/SettingsPanel';
import TemplatesPanel from './components/TemplatesPanel';
import CRMBoard from './components/CRMBoard';
import ProspectMap from './components/ProspectMap';
import ProspectDrawer from './components/ProspectDrawer';

import { Menu } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab]           = useState('dashboard');
  const [sessions, setSessions]             = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState('session-1');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Per-session data
  const [waStatus, setWaStatus]             = useState({});      // { [sessionId]: statusObj }
  const [stats, setStats]                   = useState({});
  const [campaigns, setCampaigns]           = useState([]);
  const [analytics, setAnalytics]           = useState(null);
  const [campaignLogs, setCampaignLogs]     = useState({});      // { [campaignId]: log[] }
  const [unreadReplies, setUnreadReplies]   = useState(0);

  const [showNewCampModal, setShowNewCampModal] = useState(false);
  const [selectedProspects, setSelectedProspects] = useState(null);
  
  // New States
  const [drawerProspect, setDrawerProspect] = useState(null);
  const [viewMode, setViewMode] = useState('list');

  const handleStartCampaignWithProspects = (ids) => {
    setSelectedProspects(ids);
    setShowNewCampModal(true);
  };

  // ─── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    const res = await api.getSessions();
    if (res.success) setSessions(res.data);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await api.stats(currentSessionId);
    if (res.success) setStats(res);
  }, [currentSessionId]);

  const fetchCampaigns = useCallback(async () => {
    const res = await api.getCampaigns(currentSessionId);
    if (!res.success) return;
    setCampaigns(res.data || []);
    // Load logs for each campaign (non-blocking)
    (res.data || []).forEach(camp => {
      api.getCampaignLogs(camp.id, currentSessionId).then(l => {
        if (l.success) setCampaignLogs(prev => ({ ...prev, [camp.id]: l.data }));
      });
    });
  }, [currentSessionId]);

  const fetchAnalytics = useCallback(async () => {
    const res = await api.getAnalytics(currentSessionId);
    if (res.success) setAnalytics(res.data);
  }, [currentSessionId]);

  const fetchUnread = useCallback(async () => {
    const res = await api.getReplies(currentSessionId);
    if (res.success && Array.isArray(res.data)) {
      const total = res.data.reduce((sum, c) => sum + (c.unread || 0), 0);
      setUnreadReplies(total);
    }
  }, [currentSessionId]);

  const refreshAll = useCallback(() => {
    fetchStats();
    fetchCampaigns();
    fetchAnalytics();
    fetchUnread();
  }, [fetchStats, fetchCampaigns, fetchAnalytics, fetchUnread]);

  // ─── Workspace creation ──────────────────────────────────────────────────────

  const handleCreateWorkspace = async () => {
    const name = window.prompt('Nombre del nuevo espacio de trabajo:');
    if (!name?.trim()) return;
    const res = await api.createSession(name.trim());
    if (res.success) {
      await fetchSessions();
      setCurrentSessionId(res.id);
      toast.success(`Espacio "${name}" creado`);
    } else {
      toast.error(res.error || 'Error creando espacio');
    }
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSessions();
  }, []);

  // Si la sesión activa fue eliminada, cambiar automáticamente a la primera disponible
  useEffect(() => {
    if (sessions.length > 0 && !sessions.find(s => s.id === currentSessionId)) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId]);

  // Limpiar y recargar al cambiar de sesión
  useEffect(() => {
    // Vaciar estado de la sesión anterior de inmediato para evitar datos cruzados
    setCampaigns([]);
    setStats({});
    setAnalytics(null);
    setCampaignLogs({});
    setUnreadReplies(0);
    fetchStats();
    fetchCampaigns();
    fetchAnalytics();
    fetchUnread();
  }, [currentSessionId]);

  // ─── Socket.IO listeners ─────────────────────────────────────────────────────

  useEffect(() => {
    // Emit initial WA status for the current session
    const statusKey = `whatsapp:status:${currentSessionId}`;
    const handleWaStatus = (data) => {
      setWaStatus(prev => ({ ...prev, [currentSessionId]: data }));
    };
    socket.on(statusKey, handleWaStatus);

    // Campaign logs — solo del espacio activo
    const handleCampaignLog = (logData) => {
      if (logData.sessionId && logData.sessionId !== currentSessionId) return;
      setCampaignLogs(prev => {
        const existing = prev[logData.campaignId] || [];
        return { ...prev, [logData.campaignId]: [...existing, logData].slice(-100) };
      });
    };
    socket.on('campaign:log', handleCampaignLog);

    // Campaign progress / completion / pause → solo del espacio activo
    const handleCampaignProgress = (data) => {
      if (data?.sessionId && data.sessionId !== currentSessionId) return;
      fetchCampaigns();
    };
    const handleCampaignCompleted = (data) => {
      if (data?.sessionId && data.sessionId !== currentSessionId) return;
      fetchCampaigns();
      fetchAnalytics();
      toast.success('Campaña completada');
    };
    const handleCampaignPaused = (data) => {
      if (data?.sessionId && data.sessionId !== currentSessionId) return;
      fetchCampaigns();
    };
    socket.on('campaign:progress',  handleCampaignProgress);
    socket.on('campaign:completed', handleCampaignCompleted);
    socket.on('campaign:paused',    handleCampaignPaused);

    // WA replies → increment unread badge
    const replyKey = `wa:reply:${currentSessionId}`;
    const handleReply = () => fetchUnread();
    socket.on(replyKey, handleReply);

    return () => {
      socket.off(statusKey, handleWaStatus);
      socket.off('campaign:log', handleCampaignLog);
      socket.off('campaign:progress',  handleCampaignProgress);
      socket.off('campaign:completed', handleCampaignCompleted);
      socket.off('campaign:paused',    handleCampaignPaused);
      socket.off(replyKey, handleReply);
    };
  }, [currentSessionId, fetchCampaigns, fetchAnalytics, fetchUnread]);

  // Also listen for WA status on ALL other sessions (for sidebar dots)
  useEffect(() => {
    const handlers = sessions
      .filter(s => s.id !== currentSessionId)
      .map(s => {
        const key = `whatsapp:status:${s.id}`;
        const fn = (data) => setWaStatus(prev => ({ ...prev, [s.id]: data }));
        socket.on(key, fn);
        return { key, fn };
      });
    return () => handlers.forEach(({ key, fn }) => socket.off(key, fn));
  }, [sessions, currentSessionId]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const currentWaStatus = waStatus[currentSessionId] || { connected: false, state: 'DISCONNECTED', qr: null };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-dark-950 text-white overflow-hidden">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid rgba(148,163,184,0.15)', fontSize: '13px' },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />

      {/* Top Bar solo para Móviles */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-800 bg-dark-900 z-40">
        <h1 className="text-xl font-black tracking-tighter bg-gradient-to-br from-white via-slate-200 to-slate-500 bg-clip-text text-transparent">
          PROSPECTOR<span className="text-primary-500">.AI</span>
        </h1>
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 bg-slate-800 rounded-lg text-slate-300 hover:text-white"
        >
          <Menu size={24} />
        </button>
      </div>

      <Sidebar
        activeTab={activeTab}
        setActiveTab={(t) => { setActiveTab(t); setIsMobileMenuOpen(false); }}
        sessions={sessions || []}
        currentSessionId={currentSessionId}
        setCurrentSessionId={setCurrentSessionId}
        waStatus={waStatus}
        unreadReplies={unreadReplies}
        onNewSession={handleCreateWorkspace}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar relative">
        <div className="p-4 md:p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <Dashboard
                key="dashboard"
                stats={stats}
                campaigns={campaigns}
                waStatus={currentWaStatus}
                analytics={analytics}
                currentSessionId={currentSessionId}
                onRefresh={refreshAll}
              />
            )}

            {activeTab === 'prospects' && (
              <ProspectsTable
                key="prospects"
                sessionId={currentSessionId}
                onStartCampaign={handleStartCampaignWithProspects}
              />
            )}

            {activeTab === 'search' && (
              <SearchPanel
                key="search"
                sessionId={currentSessionId}
                onProspectsAdded={refreshAll}
              />
            )}

            {activeTab === 'crm' && (
              <div key="crm" className="h-full flex flex-col space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white">CRM Pipeline</h2>
                  <p className="text-slate-400 text-sm mt-0.5">Arrastra y suelta prospectos para cambiar su estado</p>
                </div>
                <CRMBoard 
                  sessionId={currentSessionId} 
                  onProspectClick={(p) => setDrawerProspect(p)} 
                />
              </div>
            )}

            {activeTab === 'map' && (
              <div key="map" className="h-full flex flex-col space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white">Mapa Interactivo</h2>
                  <p className="text-slate-400 text-sm mt-0.5">Visualiza tus prospectos geográficamente</p>
                </div>
                <ProspectMap 
                  sessionId={currentSessionId} 
                  onProspectClick={(p) => setDrawerProspect(p)} 
                />
              </div>
            )}

            {activeTab === 'campaigns' && (
              <div key="campaigns" className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-white">Campañas</h2>
                    <p className="text-slate-400 text-sm mt-0.5">{campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''} en este espacio</p>
                  </div>
                  <button
                    onClick={() => setShowNewCampModal(true)}
                    className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold flex items-center gap-2 text-sm shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all active:scale-95"
                  >
                    + Nueva Campaña
                  </button>
                </div>
                <CampaignGrid
                  campaigns={campaigns}
                  campaignLogs={campaignLogs}
                  sessionId={currentSessionId}
                  onRefresh={fetchCampaigns}
                />
              </div>
            )}

            {activeTab === 'templates' && (
              <TemplatesPanel key="templates" />
            )}

            {activeTab === 'analytics' && (
              <div key="analytics" className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white">Analytics</h2>
                  <p className="text-slate-400 text-sm mt-0.5">Métricas de rendimiento de tu operación</p>
                </div>
                <AnalyticsDashboard analytics={analytics} sessionId={currentSessionId} />
              </div>
            )}

            {activeTab === 'inbox' && (
              <div key="inbox" className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white">Inbox WhatsApp</h2>
                  <p className="text-slate-400 text-sm mt-0.5">Respuestas entrantes de tus prospectos</p>
                </div>
                <WhatsAppInbox
                  sessionId={currentSessionId}
                />
              </div>
            )}

            {activeTab === 'settings' && (
              <SettingsPanel
                key="settings"
                sessions={sessions}
                currentSessionId={currentSessionId}
                onRefresh={() => { fetchSessions(); refreshAll(); }}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <NewCampaignModal
        show={showNewCampModal}
        onClose={() => { setShowNewCampModal(false); setSelectedProspects(null); }}
        sessionId={currentSessionId}
        onCreated={fetchCampaigns}
        preSelectedProspects={selectedProspects}
      />

      <ProspectDrawer
        prospect={drawerProspect}
        onClose={() => setDrawerProspect(null)}
        sessionId={currentSessionId}
        onUpdate={refreshAll}
      />
    </div>
  );
}
