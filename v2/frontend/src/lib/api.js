const BASE = 'https://prospector-ai-production-94fe.up.railway.app';

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

export const api = {
  // Health
  health: () => req('GET', '/api/health'),

  // Stats
  stats: (sid) => req('GET', `/api/stats?sessionId=${sid}`),

  // Sessions
  getSessions: () => req('GET', '/api/sessions'),
  createSession: (name) => req('POST', '/api/sessions', { name }),
  updateSession: (id, data) => req('PUT', `/api/sessions/${id}`, data),
  deleteSession: (id) => req('DELETE', `/api/sessions/${id}`),
  wakeSession: (id) => req('POST', `/api/sessions/${id}/wake`),

  // Prospects
  getProspects: (sid, params = {}) => {
    const qs = new URLSearchParams({ sessionId: sid, ...params }).toString();
    return req('GET', `/api/prospects?${qs}`);
  },
  clearProspects: (sid) => req('DELETE', `/api/prospects/clear?sessionId=${sid}`),
  bulkDeleteProspects: (ids, sid) => req('DELETE', '/api/prospects/bulk', { ids, sessionId: sid }),
  exportProspectsUrl: (sid) => `${BASE}/api/prospects/export?sessionId=${sid}`,
  importProspects: (rows, sid) => req('POST', '/api/prospects/import', { rows, sessionId: sid }),
  updateProspectStage: (id, stage, sid) => req('PUT', `/api/prospects/${id}/stage`, { stage, sessionId: sid }),
  updateProspectTags: (id, tags, sid) => req('PUT', `/api/prospects/${id}/tags`, { tags, sessionId: sid }),
  getProspectNotes: (id, sid) => req('GET', `/api/prospects/${id}/notes?sessionId=${sid}`),
  addProspectNote: (id, content, sid) => req('POST', `/api/prospects/${id}/notes`, { content, sessionId: sid }),
  deleteProspectNote: (id, noteId, sid) => req('DELETE', `/api/prospects/${id}/notes/${noteId}?sessionId=${sid}`),
  getProspectActivity: (id, sid) => req('GET', `/api/prospects/${id}/activity?sessionId=${sid}`),
  getProspectsMap: (sid) => req('GET', `/api/prospects/map?sessionId=${sid}`),
  bulkUpdateStage: (ids, stage, sid) => req('PUT', '/api/prospects/bulk/stage', { ids, stage, sessionId: sid }),

  // Search
  search: (body) => req('POST', '/api/search', body),

  // Campaigns
  getCampaigns: (sid) => req('GET', `/api/campaigns?sessionId=${sid}`),
  createCampaign: (data) => req('POST', '/api/campaigns', data),
  startCampaign: (id) => req('POST', `/api/campaigns/${id}/start`),
  pauseCampaign: (id) => req('POST', `/api/campaigns/${id}/pause`),
  scheduleCampaign: (id, scheduledAt) => req('POST', `/api/campaigns/${id}/schedule`, { scheduledAt }),
  unscheduleCampaign: (id) => req('DELETE', `/api/campaigns/${id}/schedule`),
  getCampaignLogs: (id, sid) => req('GET', `/api/campaigns/${id}/logs?sessionId=${sid}`),
  deleteCampaign: (id, sid) => req('DELETE', `/api/campaigns/${id}?sessionId=${sid}`),
  resetCampaign: (id, sid) => req('POST', `/api/campaigns/${id}/reset?sessionId=${sid}`),
  cloneCampaign: (id, sid) => req('POST', `/api/campaigns/${id}/clone`, { sessionId: sid }),

  // WhatsApp
  resetWA: (sid) => req('POST', `/api/wa/reset?sessionId=${sid}`),

  // Replies
  getReplies: (sid, page = 1) => req('GET', `/api/replies?sessionId=${sid}&page=${page}`),
  getConversation: (sid, phone) => req('GET', `/api/replies/${encodeURIComponent(phone)}?sessionId=${sid}`),

  // Analytics
  getAnalytics: (sid) => req('GET', `/api/analytics?sessionId=${sid}`),
  getAnalyticsActivity: (sid) => req('GET', `/api/analytics/activity?sessionId=${sid}`),
  getAnalyticsStages: (sid) => req('GET', `/api/analytics/stages?sessionId=${sid}`),

  // Templates
  getTemplates: () => req('GET', '/api/templates'),
  createTemplate: (data) => req('POST', '/api/templates', data),
  updateTemplate: (id, data) => req('PUT', `/api/templates/${id}`, data),
  deleteTemplate: (id) => req('DELETE', `/api/templates/${id}`),

  // Blacklist
  getBlacklist: (sid) => req('GET', `/api/blacklist?sessionId=${sid}`),
  addBlacklist: (phone, reason, sid) => req('POST', '/api/blacklist', { phone, reason, sessionId: sid }),
  deleteBlacklist: (phone, sid) => req('DELETE', `/api/blacklist/${encodeURIComponent(phone)}?sessionId=${sid}`),
  importBlacklist: (phones, sid) => req('POST', '/api/blacklist/import', { phones, sessionId: sid }),

  // Sequences
  getSequences: (sid) => req('GET', `/api/sequences?sessionId=${sid}`),
  createSequence: (data) => req('POST', '/api/sequences', data),
  updateSequence: (id, data) => req('PUT', `/api/sequences/${id}`, data),
  deleteSequence: (id) => req('DELETE', `/api/sequences/${id}`),

  // AI
  aiGenerate: (data) => req('POST', '/api/ai/generate', data),
  aiImprove: (data) => req('POST', '/api/ai/improve', data),
  getAISettings: () => req('GET', '/api/settings/ai'),
  saveAISettings: (data) => req('POST', '/api/settings/ai', data),

  // Image upload (multipart)
  uploadImage: (formData) =>
    fetch(`${BASE}/api/upload/image`, { method: 'POST', body: formData }).then(r => r.json()),

  // Instagram Graph API
  getIGSettings: () => req('GET', '/api/settings/instagram'),
  saveIGSettings: (data) => req('POST', '/api/settings/instagram', data),
  verifyIGCredentials: () => req('POST', '/api/settings/instagram/verify'),
  searchInstagram: (data) => req('POST', '/api/search/instagram', data),
};
