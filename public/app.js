/* =============================================================
   PROSPECTOR AI — Frontend Optimizado 2026
   · Todos los botones funcionales
   · Multi-mensaje en plantillas y campañas
   · Renderizado paginado, filtros debounce
   · Socket.IO tiempo real
   =============================================================*/

const API = '';
let socket;

// ── Estado global ────────────────────────────────────────────
const State = {
  prospects:       [],
  campaigns:       [],
  templates:       [],
  niches:          [],
  results:         [],
  selected:        new Set(),
  searchSel:       new Set(),
  filter:          { status: 'all', niche: '', text: '' },
  page:            1,
  pageSize:        50,
  selectedEmoji:   '🚀',
  uploadedImage:   null,
  selProspectIds:  [],
  currentSessionId: 'session-1',
  // Búsquedas aisladas: sessionId → { results, searchSel, searching }
  sessionSearch:   {},
  // Multi-campaign monitors: campaignId → { name, sent, failed, total, logs[] }
  monitors:        new Map(),
  
  // Notificaciones
  notifications:   [], // { id, type, title, message, time, read }
  notifFilter:     'all'
};

// --- Helpers para aislar la búsqueda por sesión ---
function getSessionSearch(sid) {
  if (!State.sessionSearch[sid]) {
    State.sessionSearch[sid] = { results: [], searchSel: new Set(), searching: false };
  }
  return State.sessionSearch[sid];
}
function saveSessionSearch(sid) {
  const ss = getSessionSearch(sid);
  ss.results   = State.results.slice();
  ss.searchSel = new Set(State.searchSel);
}
function restoreSessionSearch(sid) {
  const ss = getSessionSearch(sid);
  State.results   = ss.results   || [];
  State.searchSel = ss.searchSel || new Set();
}

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  initSocket();
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('fading');           // pointer-events:none immediately
    setTimeout(() => {
      splash.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    }, 420);
  }, 1500);
  loadAll();
});

// ════════════════════════════════════════════════════════════
// SOCKET.IO
// ════════════════════════════════════════════════════════════
function initSocket() {
  try {
    socket = io(); // permite polling + websocket automático
    socket.onAny((evt) => {
      if (evt.startsWith('whatsapp:')) fetchWAStatus();
    });
    
    socket.on('whatsapp:message',   ({ from, body, sessionId }) => {
      addActivity('reply', `Respuesta de ${from.replace('@c.us','')} ${sessionId ? `[${sessionId}]` : ''}: "${body.slice(0,50)}"`);
      markProspectReplied(from);
    });
    socket.on('search:progress', (data) => {
      // Actualizar progreso SÓLO si el usuario está viendo ESE entorno
      if (data.sessionId !== State.currentSessionId) return;
      updateSearchProgress(data.pct, data.text);
    });

    socket.on('search:complete', (data) => {
      if (data.sessionId !== State.currentSessionId) return;
      showToast('success', `✅ Búsqueda lista [${data.sessionId}]`, `${data.count} prospectos válidos`);
    });

    socket.on('search:results_ready', (data) => {
      const { sessionId, results, duplicatesRemoved } = data;

      // Marcar como no-buscando en ese entorno
      getSessionSearch(sessionId).searching = false;
      getSessionSearch(sessionId).results   = results || [];
      getSessionSearch(sessionId).searchSel = new Set();

      // Si el usuario está viendo ESTE entorno, actualizar la UI
      if (sessionId === State.currentSessionId) {
        State.results   = results || [];
        State.searchSel = new Set();

        if (document.getElementById('autoSave').checked && State.results.length > 0) {
          postJSON('/api/prospects/bulk', { prospects: State.results, sessionId }).then(saved => {
            if (saved.added > 0) {
              showToast('success', '✅ Auto-guardado', `${saved.added} prospectos en [${sessionId}]`);
              fetchProspects(); fetchStats(); fetchNiches();
            }
          });
        }

        let display = State.results;
        if (document.getElementById('onlyNoWeb').checked) display = display.filter(r => !r.hasWebsite);
        renderSearchResults(display);
        setProgress(100, `¡Listo! ${display.length} prospectos`);

        const btn = document.getElementById('searchBtn');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> Iniciar Búsqueda Inteligente`;
        }
      } else {
        // El usuario está en OTRO entorno: notificación discreta
        showToast('info', `Entorno [${sessionId}]`, `${(results||[]).length} prospectos listos. Cambia de entorno para verlos.`);
      }
    });

    socket.on('search:duplicates_removed', (data) => {
      if (data.sessionId !== State.currentSessionId) return;
      showToast('info', 'Duplicados filtrados', `Se descartaron ${data.count} ya contactados en [${data.sessionId}]`);
    });

    socket.on('search:error', (data) => {
      getSessionSearch(data.sessionId).searching = false;
      if (data.sessionId !== State.currentSessionId) return;
      showToast('error', 'Error en búsqueda', data.message || data.error);
      document.getElementById('searchProgress').classList.add('hidden');
      const btn = document.getElementById('searchBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> Iniciar Búsqueda Inteligente`;
      }
    });
    socket.on('prospects:updated', () => { fetchProspects(); fetchStats(); });
    socket.on('campaigns:updated', fetchCampaigns);
    socket.on('campaign:started',  ({ campaignId, name, total, sessionId: campSid }) => {
      addCampaignMonitor(campaignId, name, total, campSid);
      showToast('success', '▶ Campaña iniciada', `"${name}" — ${total} prospectos`);
      fetchCampaigns();
    });
    socket.on('campaign:progress', d => updateCampaignMonitor(d));
    socket.on('campaign:sleeping', ({ reason, waitMinutes, campaignId }) => {
      appendMonitorLog(campaignId, 'warn', reason);
      updateMonitorStatus(campaignId, `⏰ ${reason}`);
      addNotification('warning', 'Pausa en Campaña', reason);
    });
    socket.on('campaign:batch_pause', ({ reason, pauseSeconds, campaignId }) => {
      appendMonitorLog(campaignId, 'pause', `${reason} (${pauseSeconds}s)`);
      showToast('info', '⏸ Pausa anti-ban', reason.slice(0,60));
    });
    socket.on('campaign:log', ({ campaignId, level, message }) => {
      appendMonitorLog(campaignId, level, message);
      // Solo notificar si es un error o alerta crítica para no saturar
      if (level === 'error' || level === 'critical') {
        addNotification('error', 'Error en Campaña', message);
      }
    });
    socket.on('campaign:completed', ({ campaignId, sent, failed, total, status }) => {
      removeCampaignMonitor(campaignId);
      showToast('success', '🏁 Campaña completada', `${sent} enviados · ${failed} fallidos`);
      fetchCampaigns(); fetchStats();
    });
    socket.on('campaign:paused', ({ campaignId }) => {
      removeCampaignMonitor(campaignId);
      showToast('warning', 'Campaña pausada');
      fetchCampaigns();
    });
    socket.on('campaign:error', ({ campaignId, prospect, error }) => {
      appendMonitorLog(campaignId, 'error', `✗ ${prospect}: ${error}`);
      addNotification('error', `Error con ${prospect}`, error);
    });
  } catch(e) { console.warn('Socket.IO no disponible:', e.message); }
}

// ════════════════════════════════════════════════════════════
// CARGA INICIAL
// ════════════════════════════════════════════════════════════
async function loadAll() {
  await Promise.all([fetchStats(), fetchProspects(), fetchCampaigns(), fetchTemplates(), fetchWAStatus()]);
}

// ════════════════════════════════════════════════════════════
// NAVEGACIÓN
// ════════════════════════════════════════════════════════════
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById(`nav-${page}`)?.classList.add('active');
  const names = {
    dashboard:'Dashboard', search:'Buscar Prospectos',
    prospects:'Prospectos', campaigns:'Campañas',
    templates:'Plantillas', connect:'WhatsApp', niches:'Nichos & Categorías'
  };
  document.getElementById('breadcrumb').textContent = names[page] || page;
  if (page === 'dashboard') fetchStats();
  if (page === 'prospects') { State.page = 1; renderProspects(); buildNicheQuickTags(); }
  if (page === 'campaigns') { renderCampaigns(); fetchDailyStats(); }
  if (page === 'templates') renderTemplates();
  if (page === 'niches')    fetchNiches();
  if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('mobile-open');
}

function toggleSidebar() {
  const sb   = document.getElementById('sidebar');
  const main = document.getElementById('main');
  if (window.innerWidth <= 900) sb.classList.toggle('mobile-open');
  else { sb.classList.toggle('collapsed'); main.classList.toggle('expanded'); }
}

// ════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════
async function fetchStats() {
  try {
    const d = await getJSON('/api/stats');
    animCount('stat-prospects', d.totalProspects   || 0);
    animCount('stat-sent',      d.messagesSent     || 0);
    animCount('stat-replies',   d.repliesReceived  || 0);
    setText('stat-conversion', (d.conversionRate || 0) + '%');
    setText('prospectsCount',   d.totalProspects   || 0);
    const tot = d.totalProspects || 1;
    barSet('noWebBar',   'noWebCount',   d.withoutWebsite || 0, tot);
    barSet('withWebBar', 'withWebCount', d.withWebsite    || 0, tot);
    barSet('withIgBar',  'withIgCount',  d.withInstagram  || 0, tot);
  } catch {}
}

function animCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = parseInt(el.textContent) || 0;
  const diff = target - from;
  let n = 0;
  const t = setInterval(() => {
    n++;
    el.textContent = Math.round(from + diff * n / 25);
    if (n >= 25) { el.textContent = target; clearInterval(t); }
  }, 20);
}

function barSet(barId, countId, val, tot) {
  setText(countId, val);
  const el = document.getElementById(barId);
  if (el) el.style.width = (tot > 0 ? Math.round(val / tot * 100) : 0) + '%';
}

// ════════════════════════════════════════════════════════════
// PROSPECTS — Fetch + renderizado paginado
// ════════════════════════════════════════════════════════════
async function fetchProspects() {
  try {
    const d = await getJSON(`/api/prospects?limit=500&sessionId=${State.currentSessionId}`);
    State.prospects = d.data || d;
    setText('prospectsCount', State.prospects.length);
    renderProspects();
    buildNicheFilter();
    renderDashCampaigns();
  } catch (e) { console.warn('[prospects]', e); }
}

function getFilteredProspects() {
  const { status, niche, text } = State.filter;
  const t = text.toLowerCase();
  return State.prospects.filter(p => {
    if (status !== 'all' && p.status !== status) return false;
    if (niche && p.niche !== niche) return false;
    if (t && !(p.name||'').toLowerCase().includes(t) &&
             !(p.phone||'').includes(t) &&
             !(p.niche||'').toLowerCase().includes(t)) return false;
    return true;
  });
}

function renderProspects() {
  const filtered  = getFilteredProspects();
  const empty     = document.getElementById('prospectsEmpty');
  const tbody     = document.getElementById('prospectsBody');
  const start     = (State.page - 1) * State.pageSize;
  const pageData  = filtered.slice(start, start + State.pageSize);

  empty.classList.toggle('hidden', filtered.length > 0);

  tbody.innerHTML = pageData.map(p => `
    <tr>
      <td><input type="checkbox" class="pro-cb" data-id="${p.id}" ${State.selected.has(p.id)?'checked':''} onchange="handleCheck(this)"></td>
      <td class="prospect-name">${esc(p.name)}</td>
      <td>${p.phone ? `<span style="color:var(--green-2)">${p.phone}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
      <td><span class="chip">${esc(p.niche||'—')}</span></td>
      <td>${p.rating ? `<span class="rating-stars">${stars(p.rating)}</span> ${p.rating}` : '<span style="color:var(--text-3)">—</span>'}</td>
      <td>${p.hasWebsite ? '<span class="tag-yes">✓</span>' : '<span class="no-web-tag">⚡ Sin web</span>'}</td>
      <td>${p.instagram ? `<span style="color:var(--purple-light)">${esc(p.instagram)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
      <td><span class="status-chip status-${p.status||'new'}">${statusLbl(p.status)}</span></td>
      <td><span class="score-badge ${scoreCls(p.score)}">${p.score||50}</span></td>
      <td>
        <div class="action-btns">
          <button class="action-btn" onclick="showProspectDetail('${p.id}')" title="Detalle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="action-btn wa" onclick="openWA('${p.phone||''}')" title="WhatsApp">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a4.4 4.4 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.697.248-1.29.173-1.413z"/><path d="M12 1C5.925 1 1 5.925 1 12c0 1.9.5 3.7 1.4 5.2L1 23l5.9-1.5C8.4 22.4 10.1 23 12 23c6.075 0 11-4.925 11-11S18.075 1 12 1z"/></svg>
          </button>
          <button class="action-btn danger" onclick="delProspect('${p.id}')" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');

  renderPagination(filtered.length);
}

function renderPagination(total) {
  const pages = Math.ceil(total / State.pageSize);
  let el = document.getElementById('pagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pagination'; el.className = 'pagination';
    document.querySelector('.prospects-table-wrap').after(el);
  }
  if (pages <= 1) { el.innerHTML = ''; return; }
  const p = State.page;
  el.innerHTML = `
    <button class="pag-btn" onclick="goPage(1)" ${p===1?'disabled':''}>«</button>
    <button class="pag-btn" onclick="goPage(${p-1})" ${p===1?'disabled':''}>‹</button>
    <span class="pag-info">Pág ${p} / ${pages} · ${total} prospectos</span>
    <button class="pag-btn" onclick="goPage(${p+1})" ${p===pages?'disabled':''}>›</button>
    <button class="pag-btn" onclick="goPage(${pages})" ${p===pages?'disabled':''}>»</button>`;
}

function goPage(n) {
  const pages = Math.ceil(getFilteredProspects().length / State.pageSize);
  State.page = Math.max(1, Math.min(n, pages));
  renderProspects();
}

// ── Filtros ─────────────────────────────────────────────────
let filterTimer = null;
function filterProspects() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { State.page = 1; renderProspects(); }, 200);
}
function onFilterText() {
  State.filter.text = document.getElementById('prospectFilter').value;
  filterProspects();
}
function filterByStatus(status, btn) {
  State.filter.status = status;
  State.page = 1;
  document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderProspects();
}
function onNicheFilter() {
  State.filter.niche = document.getElementById('nicheFilter').value;
  State.page = 1;
  renderProspects();
}
function buildNicheFilter() {
  const niches = [...new Set(State.prospects.map(p => p.niche).filter(Boolean))].sort();
  const sel = document.getElementById('nicheFilter');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos los nichos</option>' +
    niches.map(n => `<option value="${n}" ${cur===n?'selected':''}>${n}</option>`).join('');
}

function buildNicheQuickTags() {
  const container = document.getElementById('nicheQuickTags');
  if (!container) return;
  const niches = [...new Set(State.prospects.map(p => p.niche).filter(Boolean))].sort();
  if (!niches.length) { container.innerHTML = ''; return; }
  const NICHE_ICONS = {
    'Odontolog': '🦷', 'Dentist': '🦷', 'Clínica dental': '🦷',
    'Abogad': '⚖️', 'Legal': '⚖️',
    'Restaurant': '🍽️', 'Comida': '🍽️',
    'Belleza': '💅', 'Salón': '💅', 'Spa': '💅',
    'Médic': '🏥', 'Salud': '🏥',
    'Inmobiliaria': '🏠', 'Finca': '🏠',
    'Tecnolog': '💻', 'Software': '💻',
    'Educac': '📚', 'Escuela': '📚',
    'Gym': '💪', 'Deporte': '💪',
    'Contab': '📊', 'Finanza': '📊'
  };
  function getIcon(niche) {
    for (const [k, v] of Object.entries(NICHE_ICONS)) {
      if (niche.toLowerCase().includes(k.toLowerCase())) return v;
    }
    return '🏢';
  }
  container.innerHTML = niches.map(n => {
    const count = State.prospects.filter(p => p.niche === n).length;
    const active = State.filter.niche === n;
    return `<button class="niche-quick-tag ${active?'active':''}" onclick="quickFilterNiche('${n.replace(/'/g,"\\'")}')">` +
      `${getIcon(n)} ${esc(n)} <span class="niche-quick-count">${count}</span></button>`;
  }).join('');
}

function quickFilterNiche(niche) {
  // Toggle: si ya está activo, quitar filtro
  if (State.filter.niche === niche) {
    State.filter.niche = '';
    const sel = document.getElementById('nicheFilter');
    if (sel) sel.value = '';
  } else {
    State.filter.niche = niche;
    const sel = document.getElementById('nicheFilter');
    if (sel) sel.value = niche;
  }
  State.page = 1;
  buildNicheQuickTags();
  renderProspects();
}

// ── Selección ───────────────────────────────────────────────
function handleCheck(cb) {
  if (cb.checked) State.selected.add(cb.dataset.id);
  else            State.selected.delete(cb.dataset.id);
  updateBulkBar();
}
function toggleSelectAll() {
  const allChecked = document.getElementById('selectAll').checked;
  document.querySelectorAll('.pro-cb').forEach(cb => {
    cb.checked = allChecked;
    if (allChecked) State.selected.add(cb.dataset.id);
    else            State.selected.delete(cb.dataset.id);
  });
  updateBulkBar();
}
function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const n   = State.selected.size;
  bar.classList.toggle('hidden', n === 0);
  setText('bulkCount', `${n} seleccionado${n!==1?'s':''}`);
}

// ── CRUD ───────────────────────────────────────────────────
async function delProspect(id) {
  if (!confirm('¿Eliminar este prospecto?')) return;
  await fetch(`/api/prospects/${id}`, { method: 'DELETE' });
  State.prospects = State.prospects.filter(p => p.id !== id);
  State.selected.delete(id);
  renderProspects();
  fetchStats();
  showToast('success', 'Prospecto eliminado');
}
async function deleteSelected() {
  const ids = [...State.selected];
  if (!ids.length) return showToast('warning', 'Nada seleccionado');
  if (!confirm(`¿Eliminar ${ids.length} prospectos?`)) return;
  await postJSON('/api/prospects/delete-bulk', { ids });
  State.prospects = State.prospects.filter(p => !State.selected.has(p.id));
  State.selected.clear();
  updateBulkBar();
  renderProspects();
  fetchStats();
  showToast('success', `${ids.length} prospectos eliminados`);
}
function createCampaignFromSelected() {
  State.selProspectIds = [...State.selected];
  showCreateCampaign();
}
function exportProspects() {
  const rows = State.prospects.map(p =>
    [p.name, p.phone, p.niche, p.rating, p.hasWebsite?'Sí':'No', p.instagram||'', p.status, p.score]);
  const csv = [['Nombre','Teléfono','Nicho','Rating','Web','Instagram','Estado','Score'],...rows]
    .map(r => r.map(v => `"${v||''}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: `prospectos_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
  showToast('success', 'CSV exportado');
}
function openWA(phone) {
  const p = String(phone||'').replace(/\D/g,'');
  if (p) window.open(`https://wa.me/${p}`, '_blank');
  else showToast('warning', 'Sin teléfono', 'Este prospecto no tiene número');
}
function showAddProspect() {
  // Open a real add-prospect modal
  document.getElementById('addProspectName').value    = '';
  document.getElementById('addProspectPhone').value   = '';
  document.getElementById('addProspectNiche').value   = '';
  document.getElementById('addProspectWebsite').value = '';
  document.getElementById('addProspectIG').value      = '';
  openModal('addProspectModal');
}

async function saveManualProspect() {
  const name    = (document.getElementById('addProspectName')?.value    || '').trim();
  const phone   = (document.getElementById('addProspectPhone')?.value   || '').replace(/\s/g, '');
  const niche   = (document.getElementById('addProspectNiche')?.value   || '').trim();
  const website = (document.getElementById('addProspectWebsite')?.value || '').trim();
  const ig      = (document.getElementById('addProspectIG')?.value      || '').trim();

  if (!name)  return showToast('warning', 'Campo requerido', 'Escribe el nombre del negocio');
  if (!phone) return showToast('warning', 'Campo requerido', 'Escribe el número de teléfono/WhatsApp');

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return showToast('warning', 'Teléfono inválido', 'Mínimo 7 dígitos');

  const p = {
    name,
    phone: digits,
    whatsapp: digits,
    niche: niche || 'Negocio Local',
    website,
    hasWebsite: website.length > 4,
    instagram: ig,
    email: '',
    rating: null,
    reviews: '0',
    score: 50,
    source: 'manual'
  };

  try {
    await postJSON('/api/prospects', { ...p, sessionId: State.currentSessionId });
    closeModal('addProspectModal');
    await fetchProspects();
    fetchStats();
    showToast('success', '✅ Prospecto añadido', `${name} → [${State.currentSessionId}]`);
  } catch (e) {
    showToast('error', 'Error al guardar', e.message);
  }
}


function showProspectDetail(id) {
  const p = State.prospects.find(x => x.id === id);
  if (!p) return;
  setText('prospectModalName', p.name);
  document.getElementById('prospectModalBody').innerHTML = `
    <div class="prospect-detail-grid">
      ${dField('Nombre', p.name)}
      ${dField('Teléfono/WhatsApp', p.phone||'—')}
      ${dField('Nicho', p.niche||'—')}
      ${dField('Calificación', p.rating ? `${stars(p.rating)} ${p.rating} (${p.reviews||0} reseñas)` : '—')}
      ${dField('Sitio Web', p.website ? `<a href="${p.website}" target="_blank">${p.website}</a>` : 'Sin sitio web')}
      ${dField('Instagram', p.instagram ? `<a href="https://instagram.com/${p.instagram.replace('@','')}" target="_blank">${p.instagram}</a>` : '—')}
      ${dField('Dirección', p.address||'—')}
      ${dField('Estado', `<span class="status-chip status-${p.status||'new'}">${statusLbl(p.status)}</span>`)}
      ${dField('Score IA', `<span class="score-badge ${scoreCls(p.score)}">${p.score||50}/100</span>`)}
      ${dField('Fuente', p.source||'manual')}
      ${dField('Registrado', fmtDate(p.createdAt))}
      ${dField('Último contacto', p.lastContactedAt ? fmtDate(p.lastContactedAt) : 'Nunca')}
    </div>`;
  document.getElementById('sendWABtn').onclick = () => openWA(p.phone||'');
  openModal('prospectModal');
}
function dField(label, val) {
  return `<div class="detail-field"><label>${label}</label><span>${val}</span></div>`;
}

// ════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════
async function executeSearch() {
  const query      = document.getElementById('searchQuery').value.trim();
  const location   = document.getElementById('searchLocation').value.trim();
  const source     = document.getElementById('searchSource').value;
  const maxResults = parseInt(document.getElementById('maxResults').value) || 20;
  const sessionId  = State.currentSessionId;

  if (!query)    return showToast('warning', 'Campo requerido', 'Tipo de negocio');
  if (!location) return showToast('warning', 'Campo requerido', 'Ciudad o país');

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Buscando…`;

  // Marcar este entorno como "buscando"
  getSessionSearch(sessionId).searching = true;

  document.getElementById('searchProgress').classList.remove('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('progressSteps').innerHTML = '';
  setProgress(5, `[${sessionId}] Buscando "${query}" en ${location}…`);

  try {
    const data = await postJSON('/api/search', { query, location, source, maxResults, sessionId });
    if (!data.success) {
      getSessionSearch(sessionId).searching = false;
      throw new Error(data.error || 'Error desconocido');
    }
    showToast('info', `Búsqueda iniciada [${sessionId}]`, 'Recibirás los resultados automáticamente');
    // La UI se actualiza vía socket 'search:results_ready'
  } catch (e) {
    getSessionSearch(sessionId).searching = false;
    showToast('error', 'Error en búsqueda', e.message);
    document.getElementById('searchProgress').classList.add('hidden');
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> Iniciar Búsqueda Inteligente`;
  }
}

function updateSearchProgress(pct, text) { setProgress(pct, text); if (text) addProgressStep(text); }
function setProgress(pct, text) {
  const p = Math.round(Math.max(0, Math.min(100, pct)));
  document.getElementById('progressFill').style.width = p + '%';
  document.getElementById('progressPct').textContent  = p + '%';
  if (text) document.getElementById('progressTitle').textContent = text;
  if (p >= 100) setTimeout(() => document.getElementById('searchProgress').classList.add('hidden'), 800);
}
function addProgressStep(text) {
  const steps = document.getElementById('progressSteps');
  const div = document.createElement('div');
  div.className = 'progress-step';
  div.innerHTML = `<div class="progress-step-dot"></div><span>${esc(text)}</span>`;
  steps.appendChild(div);
  steps.scrollTop = steps.scrollHeight;
  while (steps.children.length > 8) steps.removeChild(steps.firstChild);
}

function renderSearchResults(results) {
  document.getElementById('resultsSection').classList.remove('hidden');
  setText('resultsTitle', `${results.length} prospectos encontrados`);
  document.getElementById('resultsGrid').innerHTML = results.map(r => `
    <div class="result-card" data-id="${r.id}" onclick="toggleResultCard('${r.id}')">
      <div class="result-card-check"></div>
      <button class="remove-result-btn" onclick="removeSearchResult('${r.id}', event)" title="Descartar este prospecto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
      <div class="result-card-name">${esc(r.name)}</div>
      <div class="result-card-niche">${esc(r.niche||'Negocio Local')}</div>
      <div class="result-card-details">
        <div class="detail-item ${r.phone?'has-value':''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/></svg>
          ${r.phone||'Sin teléfono'}
        </div>
        <div class="detail-item">⭐ ${r.rating||'N/A'}</div>
        <div class="detail-item ${r.hasWebsite?'has-value':''}">
          ${r.hasWebsite ? '🌐 Tiene web' : '<span class="no-web-tag">⚡ Sin web</span>'}
        </div>
        <div class="detail-item ${r.hasWhatsapp === true ? 'has-value' : ''}">
          ${r.hasWhatsapp === true ? '✅ WhatsApp verificado' : r.hasWhatsapp === false ? '📵 Sin WhatsApp' : '❓ Sin verificar'}
        </div>
        <div class="detail-item ${r.instagram?'has-value':''}">${r.instagram||'Sin Instagram'}</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="score-badge ${scoreCls(r.score)}">Score: ${r.score}</span>
        ${!r.hasWebsite ? '<span class="no-web-tag">🔥 Lead Caliente</span>' : ''}
      </div>
    </div>`).join('');
}

function removeSearchResult(id, event) {
  event.stopPropagation();
  State.results = State.results.filter(r => r.id !== id);
  State.searchSel.delete(id);
  
  let display = State.results;
  if (document.getElementById('onlyNoWeb').checked) display = display.filter(r => !r.hasWebsite);
  renderSearchResults(display);
}

function toggleResultCard(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  State.searchSel.has(id) ? State.searchSel.delete(id) : State.searchSel.add(id);
  card.classList.toggle('selected', State.searchSel.has(id));
}

function selectAllResults() {
  const allSel = State.searchSel.size === State.results.length;
  if (allSel) {
    State.searchSel.clear();
    document.querySelectorAll('.result-card').forEach(c => c.classList.remove('selected'));
  } else {
    State.results.forEach(r => State.searchSel.add(r.id));
    document.querySelectorAll('.result-card').forEach(c => c.classList.add('selected'));
  }
}

async function saveSelectedResults() {
  const toSave = State.results.filter(r => State.searchSel.has(r.id));
  if (!toSave.length) return showToast('warning', 'Nada seleccionado');
  const d = await postJSON('/api/prospects/bulk', { prospects: toSave, sessionId: State.currentSessionId });
  showToast('success', 'Guardados', `${d.added} prospectos nuevos en tu Entorno de Trabajo`);
  fetchProspects(); fetchStats();
}

function changeWorkspace() {
  // Guardar estado de búsqueda del entorno actual antes de salir
  saveSessionSearch(State.currentSessionId);

  // Cambiar sesión activa
  State.currentSessionId = document.getElementById('workspaceSelect').value || 'session-1';

  // Restaurar el estado de búsqueda del nuevo entorno
  restoreSessionSearch(State.currentSessionId);

  const ss = getSessionSearch(State.currentSessionId);
  const hasResults = State.results.length > 0;
  const isSearching = ss.searching;

  // Restaurar UI de búsqueda
  if (isSearching) {
    // Hay una búsqueda en curso en este entorno – mostrar progreso
    document.getElementById('searchProgress')?.classList.remove('hidden');
    document.getElementById('resultsSection')?.classList.add('hidden');
    const btn = document.getElementById('searchBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Buscando…`;
    }
    showToast('info', 'Búsqueda en curso', `El entorno ${State.currentSessionId} tiene una búsqueda activa`);
  } else if (hasResults) {
    // Hay resultados previos – mostrarlos
    document.getElementById('searchProgress')?.classList.add('hidden');
    let display = State.results;
    if (document.getElementById('onlyNoWeb')?.checked) display = display.filter(r => !r.hasWebsite);
    renderSearchResults(display);
    const btn = document.getElementById('searchBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> Iniciar Búsqueda Inteligente`;
    }
    showToast('info', `Entorno: ${State.currentSessionId}`, `${State.results.length} resultados cargados`);
  } else {
    // Sin búsquedas ni resultados – limpiar pantalla
    document.getElementById('resultsSection')?.classList.add('hidden');
    document.getElementById('searchProgress')?.classList.add('hidden');
    const btn = document.getElementById('searchBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> Iniciar Búsqueda Inteligente`;
    }
    showToast('info', 'Entorno cambiado', `Ahora en: ${State.currentSessionId}`);
  }

  fetchStats();
  fetchProspects();
  fetchCampaigns();
  fetchNiches();
}

function sendToSelectedCampaign() {
  const ids = State.results.filter(r => State.searchSel.has(r.id)).map(r => r.id);
  State.selProspectIds = ids.length ? ids : State.results.map(r => r.id);
  showCreateCampaign();
}

// ════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════
async function fetchCampaigns() {
  try { State.campaigns = await getJSON(`/api/campaigns?sessionId=${State.currentSessionId}`); renderCampaigns(); renderDashCampaigns(); } catch {}
}

function renderCampaigns() {
  const grid  = document.getElementById('campaignsGrid');
  const empty = document.getElementById('campaignsEmpty');
  if (!State.campaigns.length) {
    empty.style.display = 'flex'; grid.innerHTML = ''; grid.appendChild(empty); return;
  }
  empty.style.display = 'none';
  const cardsHTML = State.campaigns.map(c => {
    const msgs = Array.isArray(c.messages) ? c.messages.length : (c.message ? 1 : 0);
    let subTxt = `${fmtDate(c.createdAt)} · ${c.totalTargets||0} prospectos · ${msgs} mensaje(s)${c.imageUrl?' + imagen':''}`;
    if (c.status === 'scheduled' && c.scheduledAt) {
      subTxt += ` · <br><span style="color:var(--orange)">⏰ Iniciará: ${new Date(c.scheduledAt).toLocaleString()}</span>`;
    }

    return `
    <div class="campaign-card">
      <div class="campaign-card-header">
        <div>
          <div class="campaign-name">${esc(c.name)}</div>
          <div class="campaign-sub">${subTxt}</div>
        </div>
        <span class="campaign-status-badge status-${c.status}">${campLbl(c.status)}</span>
      </div>
      <div class="campaign-stats">
        <div class="camp-stat"><span class="camp-stat-val">${c.sent||0}</span><span class="camp-stat-label">Enviados</span></div>
        <div class="camp-stat"><span class="camp-stat-val">${c.replied||0}</span><span class="camp-stat-label">Respuestas</span></div>
        <div class="camp-stat"><span class="camp-stat-val">${c.sent>0?Math.round((c.replied||0)/c.sent*100):0}%</span><span class="camp-stat-label">Conversión</span></div>
      </div>
      <div class="campaign-actions">
        ${c.status === 'scheduled' ? `<button class="btn btn-sm btn-ghost" onclick="startCampaign('${c.id}')">▶ Forzar Inicio</button>` : ''}
        ${(c.status === 'draft' || c.status === 'paused') ? `<button class="btn btn-sm btn-primary" onclick="startCampaign('${c.id}')">▶ Iniciar</button>` : ''}
        ${c.status === 'running' ? `<button class="btn btn-sm btn-danger" onclick="pauseCampaign('${c.id}')">⏸ Pausar</button>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="delCampaign('${c.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
  grid.innerHTML = cardsHTML;
  grid.appendChild(empty);
}

function renderDashCampaigns() {
  const el  = document.getElementById('dashCampaigns');
  const act = State.campaigns.filter(c => c.status==='running'||c.status==='draft').slice(0,3);
  if (!act.length) {
    el.innerHTML = `<div class="empty-state-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m22 2-7 20-4-9-9-4Z"/></svg><p>Sin campañas activas</p></div>`;
    return;
  }
  el.innerHTML = act.map(c => `
    <div style="padding:10px;background:var(--bg-3);border-radius:8px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:.82rem;font-weight:600">${esc(c.name)}</div>
        <div style="font-size:.72rem;color:var(--text-2)">${c.sent||0}/${c.totalTargets||0} enviados</div>
      </div>
      <span class="campaign-status-badge status-${c.status}">${campLbl(c.status)}</span>
    </div>`).join('');
}

// ── Modal: Nueva Campaña ────────────────────────────────────
function showCreateCampaign(preselectedIds) {
  try {
    if (preselectedIds) State.selProspectIds = preselectedIds;

    // Actualizar campo visual de Sesión en el modal
    const sessSel = document.getElementById('campSessionId');
    if (sessSel) {
      sessSel.innerHTML = `<option value="${State.currentSessionId}">${State.currentSessionId}</option>`;
      sessSel.value = State.currentSessionId;
    }

    // Limpiar imagen
    State.uploadedImage = null;
    const imgArea    = document.getElementById('imageUploadArea');
    const imgPreview = document.getElementById('uploadedImagePreview');
    const campImage  = document.getElementById('campImage');
    if (imgArea)    imgArea.classList.remove('hidden');
    if (imgPreview) imgPreview.classList.add('hidden');
    if (campImage)  campImage.value = '';

    // Limpiar nombre
    const campName = document.getElementById('campName');
    if (campName) campName.value = '';

    // Restablecer modo de prospectos
    const modeEl = document.getElementById('campProspectMode');
    if (modeEl) modeEl.value = 'all_new';
    document.getElementById('nicheSelectGroup')?.classList.add('hidden');

    // Poblar nicho
    const niches = [...new Set(State.prospects.map(p => p.niche).filter(Boolean))];
    const campNiche = document.getElementById('campNiche');
    if (campNiche) campNiche.innerHTML = niches.map(n => `<option value="${n}">${n}</option>`).join('');

    // Inicializar pasos de mensaje — reconstruir opciones de plantilla
    const list = document.getElementById('messageStepsList');
    if (list) { list.innerHTML = ''; msgStepCount = 0; addMessageStep(); }

    openModal('campaignModal');
  } catch(err) {
    console.error('showCreateCampaign error:', err);
    showToast('error', 'Error al abrir campaña', err.message);
  }
}

// ── Pasos de mensajes en campaña ────────────────────────────
let msgStepCount = 0;

function addMessageStep() {
  const list = document.getElementById('messageStepsList');
  if (!list) return;
  const idx = ++msgStepCount;
  const num = list.children.length + 2; // +2 porque imagen va primero

  const div = document.createElement('div');
  div.className = 'send-step';
  div.dataset.stepIdx = String(idx);

  // Construir opciones de plantillas
  const tplOptions = State.templates.map(t =>
    `<option value="${t.id}">${esc(t.emoji||'📝')} ${esc(t.name)}</option>`
  ).join('');

  const showRemove = list.children.length > 0;

  div.innerHTML = `
    <div class="step-badge msg-badge">💬 ${num}º · Mensaje</div>
    <div class="step-content">
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
        <select class="select-input select-sm" style="flex:1;min-width:160px" onchange="loadTemplateIntoStep(this,${idx})">
          <option value="">— Cargar desde plantilla —</option>
          ${tplOptions}
        </select>
        ${showRemove ? `<button type="button" class="btn btn-danger btn-sm" onclick="removeMessageStep(this)">✕</button>` : ''}
      </div>
      <textarea class="step-textarea" data-step="${idx}" rows="5"
        placeholder="Escribe el mensaje o carga una plantilla…&#10;&#10;Variables: {nombre} {negocio} {nicho} {ciudad}&#10;Spintax (Rotación): {Hola|Buen día|Saludos}"
        oninput="updateStepPreview(${idx})"></textarea>
      <div class="step-preview">
        <div class="wa-bubble step-preview-bubble" id="stepPreview${idx}">Vista previa aparecerá aquí…</div>
      </div>
    </div>`;

  list.appendChild(div);
  renumberCampSteps();
}

function removeMessageStep(btn) {
  btn.closest('.send-step').remove();
  renumberCampSteps();
}

function renumberCampSteps() {
  document.querySelectorAll('#messageStepsList .send-step').forEach((s, i) => {
    const b = s.querySelector('.step-badge');
    if (b) b.textContent = `💬 ${i + 2}º · Mensaje`;
  });
}

function loadTemplateIntoStep(sel, idx) {
  const tpl = State.templates.find(t => t.id === sel.value);
  if (!tpl) return;

  const msgs = Array.isArray(tpl.messages) && tpl.messages.length
    ? tpl.messages : [tpl.message||''];

  const ta = document.querySelector(`textarea[data-step="${idx}"]`);
  if (ta) { ta.value = msgs[0]; updateStepPreview(idx); }

  // Si la plantilla tiene más mensajes, añadir pasos extra
  for (let i = 1; i < msgs.length; i++) {
    addMessageStep();
    const nta = document.querySelector(`textarea[data-step="${msgStepCount}"]`);
    if (nta) { nta.value = msgs[i]; updateStepPreview(msgStepCount); }
  }

  if (msgs.length > 1) showToast('info', '📋 Secuencia cargada', `${msgs.length} mensajes añadidos`);
  sel.value = ''; // reset selector
}

function updateStepPreview(idx) {
  const ta  = document.querySelector(`textarea[data-step="${idx}"]`);
  const out = document.getElementById(`stepPreview${idx}`);
  if (ta && out) out.innerHTML = esc(ta.value).replace(/\n/g,'<br>') || 'Vista previa…';
}

function getMessagesFromSteps() {
  const msgs = [];
  document.querySelectorAll('#messageStepsList textarea.step-textarea').forEach(ta => {
    if (ta.value.trim()) msgs.push(ta.value.trim());
  });
  return msgs;
}

function updateProspectMode() {
  const mode = document.getElementById('campProspectMode').value;
  document.getElementById('nicheSelectGroup').classList.toggle('hidden', mode !== 'by_niche');
}

async function createCampaign() {
  const name = (document.getElementById('campName')?.value || '').trim();
  if (!name) return showToast('warning', 'Campo requerido', 'Escribe el nombre de la campaña');

  const messages = getMessagesFromSteps();
  if (!messages.length) return showToast('warning', 'Campo requerido', 'Escribe al menos un mensaje');

  const mode = document.getElementById('campProspectMode').value;
  let prospectIds = null;

  if (mode === 'selected' && State.selProspectIds.length) {
    prospectIds = State.selProspectIds;
  } else if (mode === 'no_web') {
    prospectIds = State.prospects.filter(p => !p.hasWebsite).map(p => p.id);
  } else if (mode === 'by_niche') {
    const n = document.getElementById('campNiche').value;
    prospectIds = State.prospects.filter(p => p.niche === n).map(p => p.id);
  }

  const delayBetween = parseInt(document.getElementById('campDelay')?.value) || 45;
  const intraDelay   = parseInt(document.getElementById('campIntraDelay')?.value) || 8;
  const schedule     = document.getElementById('campSchedule')?.value || 'business';
  const scheduledAt  = document.getElementById('campScheduledAt')?.value || null;

  const imgUrl = State.uploadedImage || null;

  const sessionId = State.currentSessionId;

  try {
    await postJSON('/api/campaigns', {
      name,
      messages,
      message: messages[0],
      imageUrl: imgUrl,
      prospectIds,
      nicheFilter:   mode === 'by_niche' ? document.getElementById('campNiche').value : null,
      delayBetween,
      intraDelay,
      schedule,
      scheduledAt,
      sessionId
    });

    closeModal('campaignModal');
    State.uploadedImage    = null;
    State.selProspectIds   = [];
    await fetchCampaigns();
    showToast('success', '✅ Campaña creada', `${messages.length} mensaje(s)${imgUrl ? ' + imagen' : ''}`);
    showPage('campaigns');
  } catch (e) {
    showToast('error', 'Error al crear campaña', e.message);
  }
}

async function startCampaign(id) {
  try {
    const r = await postJSON(`/api/campaigns/${id}/start`, {});
    if (!r.success) throw new Error(r.error || 'Error al iniciar');
    showToast('success', '▶ Iniciando campaña…');
  } catch (e) { showToast('error', 'Error', e.message); }
}

async function pauseCampaign(id) {
  try {
    await postJSON(`/api/campaigns/${id}/pause`, {});
    showToast('info', '⏸ Campaña pausada');
    fetchCampaigns();
  } catch (e) { showToast('error', 'Error', e.message); }
}

async function delCampaign(id) {
  if (!confirm('¿Eliminar esta campaña?')) return;
  await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
  await fetchCampaigns();
  showToast('success', 'Campaña eliminada');
}

// ── Monitor en vivo (multi-campaign) ─────────────────────────
let monitorCampaignId = null;
function pauseActiveMonitor() { if (monitorCampaignId) pauseCampaign(monitorCampaignId); }

const LOG_ICONS  = { info:'ℹ️', warn:'⚠️', sent:'✅', pause:'⏸', error:'❌', critical:'🚨', done:'🏁', skip:'⛔', wait:'⏳' };
const LOG_COLORS = { info:'#8b9dc3', warn:'#f0c040', sent:'#4ade80', pause:'#a78bfa', error:'#f87171', critical:'#ff4444', done:'#34d399', skip:'#9ca3af', wait:'#60a5fa' };

function addCampaignMonitor(campaignId, name, total, sessionId) {
  monitorCampaignId = campaignId;
  State.monitors.set(campaignId, { name, sent: 0, failed: 0, total, progress: 0, status: '⏳ Iniciando...', logs: [], sessionId: sessionId || State.currentSessionId });
  renderMultiMonitor();
  showPage('campaigns');
}

function updateCampaignMonitor({ campaignId, sent, failed, total, current, progress }) {
  const m = State.monitors.get(campaignId);
  if (!m) return;
  Object.assign(m, { sent, failed, total, progress, status: `💬 ${current}…` });
  const card = document.getElementById(`mc-${campaignId}`);
  if (!card) { renderMultiMonitor(); return; }
  const vals = card.querySelectorAll('.mc-val');
  if (vals[0]) vals[0].textContent = sent;
  if (vals[1]) vals[1].textContent = failed;
  if (vals[2]) vals[2].textContent = total - sent;
  if (vals[3]) vals[3].textContent = progress + '%';
  const bar = card.querySelector('.mc-bar-fill');
  if (bar) bar.style.width = progress + '%';
  const st = card.querySelector('.mc-status');
  if (st) st.textContent = `💬 ${current}…`;
}

function updateMonitorStatus(campaignId, status) {
  const m = State.monitors.get(campaignId);
  if (!m) return;
  m.status = status;
  const st = document.querySelector(`#mc-${campaignId} .mc-status`);
  if (st) st.textContent = status;
}

function appendMonitorLog(campaignId, level, message) {
  const m = State.monitors.get(campaignId);
  if (!m) return;
  const now = new Date().toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  m.logs.push({ level, message, now });
  if (m.logs.length > 60) m.logs.shift();
  const logEl = document.getElementById(`monitor-log-${campaignId}`);
  if (!logEl) return;
  const line = document.createElement('div');
  line.style.cssText = `font-size:11px;padding:2px 0;color:${LOG_COLORS[level]||'#ccc'};border-bottom:1px solid rgba(255,255,255,0.05);`;
  line.textContent = `[${now}] ${LOG_ICONS[level]||''} ${message}`;
  logEl.appendChild(line);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function removeCampaignMonitor(campaignId) {
  State.monitors.delete(campaignId);
  if (monitorCampaignId === campaignId) monitorCampaignId = null;
  renderMultiMonitor();
  fetchCampaigns();
}

function renderMultiMonitor() {
  const container = document.getElementById('multiMonitor');
  if (!container) return;
  // Solo mostrar monitores que pertenecen al entorno activo
  const visibleMonitors = [...State.monitors.entries()].filter(([, m]) => !m.sessionId || m.sessionId === State.currentSessionId);
  if (!visibleMonitors.length) { container.innerHTML = ''; return; }
  container.innerHTML = visibleMonitors.map(([id, m]) => `
    <div class="camp-monitor-card" id="mc-${id}">
      <div class="mc-header">
        <div class="mc-live"><span class="live-dot"></span> EN VIVO</div>
        <div class="mc-name">${esc(m.name)}</div>
        <button class="btn btn-sm btn-danger" onclick="pauseCampaign('${id}')">⏸ Pausar</button>
      </div>
      <div class="mc-stats">
        <div class="mc-stat"><span class="mc-val">${m.sent}</span><span class="mc-lbl">Enviados</span></div>
        <div class="mc-stat"><span class="mc-val">${m.failed}</span><span class="mc-lbl">Fallidos</span></div>
        <div class="mc-stat"><span class="mc-val">${m.total - m.sent}</span><span class="mc-lbl">Restantes</span></div>
        <div class="mc-stat"><span class="mc-val">${m.progress}%</span><span class="mc-lbl">Progreso</span></div>
      </div>
      <div class="mc-bar-wrap"><div class="mc-bar-fill" style="width:${m.progress}%"></div></div>
      <p class="mc-status">${esc(m.status)}</p>
      <div class="mc-log" id="monitor-log-${id}">${m.logs.map(l =>
        `<div style="font-size:11px;padding:2px 0;color:${LOG_COLORS[l.level]||'#ccc'};border-bottom:1px solid rgba(255,255,255,0.05);">[${l.now}] ${LOG_ICONS[l.level]||''} ${esc(l.message)}</div>`
      ).join('')}</div>
    </div>`).join('');
  container.querySelectorAll('.mc-log').forEach(el => { el.scrollTop = el.scrollHeight; });
}


// Stats diarias anti-ban
async function fetchDailyStats() {
  try {
    const d = await getJSON('/api/stats/daily');
    const bar = document.getElementById('dailyLimitBar');
    const txt = document.getElementById('dailyLimitText');
    if (!bar || !txt || !d) return;
    const pct = Math.min(100, Math.round((d.sent / d.limit) * 100));
    bar.style.width = pct + '%';
    bar.style.background = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
    const activeInfo = d.active > 0 ? ` · ${d.active} campaña(s) activa(s)` : '';
    txt.textContent = `${d.sent} / ${d.limit} mensajes hoy (${pct}%)${activeInfo}`;
  } catch {}
}

// ════════════════════════════════════════════════════════════
// NICHOS & CATEGORÍAS
// ════════════════════════════════════════════════════════════
const NICHE_ICON_MAP = {
  'odontolog':'🦷','dentist':'🦷','dental':'🦷','ortod':'🦷',
  'abogad':'⚖️','legal':'⚖️','jurídic':'⚖️','notari':'⚖️',
  'restaurant':'🍽️','comida':'🍽️','cocina':'🍽️','café':'🍽️','bar':'🍺',
  'belleza':'💅','salón':'💅','estética':'💅','spa':'💅','barbería':'💈',
  'médic':'🏥','salud':'🏥','clínica':'🏥','hospital':'🏥','farmaci':'💊',
  'inmobiliar':'🏠','finca raíz':'🏠','arrien':'🏠','propiedad':'🏠',
  'tecnolog':'💻','software':'💻','sistemas':'💻','web':'🌐','diseño':'🎨',
  'educac':'📚','escuela':'📚','colegio':'📚','academia':'📚','instituto':'📚',
  'gym':'💪','deporte':'💪','fitness':'💪','entrenami':'💪',
  'contab':'📊','finanza':'📊','impuesto':'📊','auditor':'📊',
  'transport':'🚗','logístic':'🚗','mudanza':'🚗',
  'construcc':'🏗️','architect':'🏗️','ingeniería':'🏗️',
  'fotograf':'📸','video':'📸','produc':'📸'
};
function getNicheIcon(niche) {
  const l = (niche||'').toLowerCase();
  for (const [k, v] of Object.entries(NICHE_ICON_MAP)) { if (l.includes(k)) return v; }
  return '🏢';
}

async function fetchNiches() {
  try {
    const niches = await getJSON(`/api/niches?sessionId=${State.currentSessionId}`);
    State.niches = niches;
    setText('nichesCount', niches.length);
    renderNiches(niches);
  } catch (e) { console.warn('[niches]', e); }
}

function renderNiches(niches) {
  const grid  = document.getElementById('nichesGrid');
  const empty = document.getElementById('nichesEmpty');
  const statsBar = document.getElementById('nichesStatsBar');
  if (!grid) return;

  if (!niches.length) {
    if (empty) empty.style.display = 'flex';
    grid.innerHTML = '';
    if (empty) grid.appendChild(empty);
    if (statsBar) statsBar.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Stats bar global
  const totalP = niches.reduce((s, n) => s + n.total, 0);
  const totalNew = niches.reduce((s, n) => s + n.new, 0);
  const totalC = niches.reduce((s, n) => s + n.contacted, 0);
  const totalR = niches.reduce((s, n) => s + n.replied, 0);
  if (statsBar) statsBar.innerHTML = `
    <div class="niche-stat-pill purple">${niches.length} nichos</div>
    <div class="niche-stat-pill blue">${totalP} prospectos</div>
    <div class="niche-stat-pill green">${totalNew} nuevos</div>
    <div class="niche-stat-pill orange">${totalC} contactados</div>
    <div class="niche-stat-pill teal">${totalR} respondieron</div>`;

  grid.innerHTML = niches.map(n => {
    const icon = getNicheIcon(n.name);
    const contactedPct = n.total > 0 ? Math.round((n.contacted / n.total) * 100) : 0;
    const repliedPct   = n.total > 0 ? Math.round((n.replied   / n.total) * 100) : 0;
    const hasActive = n.activeCampaign;
    return `
    <div class="niche-card" onclick="filterByNiche('${n.name.replace(/'/g,"\\'")}')">
      <div class="niche-card-header">
        <div class="niche-icon-wrap">${icon}</div>
        <div class="niche-info">
          <div class="niche-name">${esc(n.name)}</div>
          <div class="niche-total">${n.total} prospectos</div>
        </div>
        ${hasActive ? `<span class="niche-live-badge"><span class="live-dot"></span> Activa</span>` : ''}
      </div>
      <div class="niche-status-row">
        <span class="niche-chip new">${n.new} Nuevos</span>
        <span class="niche-chip contacted">${n.contacted} Contactados</span>
        <span class="niche-chip replied">${n.replied} Resp.</span>
      </div>
      <div class="niche-detail-row">
        <span title="Con teléfono">📞 ${n.withPhone}</span>
        <span title="Sin web">🌐 ${n.withWebsite}</span>
        <span title="Con Instagram">📸 ${n.withInstagram}</span>
      </div>
      <div class="niche-progress">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-bottom:4px">
          <span>Contactados ${contactedPct}%</span><span>Convertidos ${repliedPct}%</span>
        </div>
        <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${contactedPct}%;background:linear-gradient(90deg,#6366f1,#a855f7);border-radius:4px;transition:width .5s"></div>
        </div>
      </div>
      <div class="niche-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();filterByNiche('${n.name.replace(/'/g,"\\'")}')">
          👁 Ver prospectos
        </button>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();createCampaignForNiche('${n.name.replace(/'/g,"\\'")}')">
          🚀 Campaña
        </button>
      </div>
    </div>`;
  }).join('');
  if (empty) grid.appendChild(empty);
}

function filterByNiche(niche) {
  State.filter.niche = niche;
  State.page = 1;
  showPage('prospects');
  const sel = document.getElementById('nicheFilter');
  if (sel) sel.value = niche;
  buildNicheQuickTags();
  renderProspects();
}

function createCampaignForNiche(niche) {
  // Pre-seleccionar nicho en modal de campaña
  State.selProspectIds = [];
  showCreateCampaign();
  setTimeout(() => {
    const modeEl = document.getElementById('campProspectMode');
    if (modeEl) { modeEl.value = 'by_niche'; updateProspectMode(); }
    const nicheEl = document.getElementById('campNiche');
    if (nicheEl) nicheEl.value = niche;
  }, 100);
}

// ════════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════════
async function fetchTemplates() {
  try {
    State.templates = await getJSON('/api/templates');
    renderTemplates();
    return State.templates;
  } catch { return []; }
}

function renderTemplates() {
  const grid  = document.getElementById('templatesGrid');
  const empty = document.getElementById('templatesEmpty');
  if (!State.templates.length) {
    empty.style.display = 'flex'; grid.innerHTML = ''; grid.appendChild(empty); return;
  }
  empty.style.display = 'none';
  grid.innerHTML = State.templates.map(t => {
    const msgs    = Array.isArray(t.messages) && t.messages.length ? t.messages : [t.message||''];
    const preview = (msgs[0]||'').slice(0, 120);
    return `
    <div class="template-card">
      <div class="template-header">
        <div class="template-emoji">${t.emoji||'📝'}</div>
        <div style="flex:1">
          <div class="template-name">${esc(t.name)}</div>
          <div class="template-niche">${esc(t.niche||'General')}</div>
        </div>
        <span class="tpl-msg-count">${msgs.length} msg${msgs.length!==1?'s':''}</span>
      </div>
      <div class="template-preview">${esc(preview)}${preview.length < (msgs[0]||'').length ? '…' : ''}</div>
      ${msgs.length > 1 ? `<div class="tpl-seq-hint">💬→💬 Secuencia de ${msgs.length} mensajes</div>` : ''}
      <div class="template-actions">
        <button class="btn btn-ghost btn-sm" onclick="editTpl('${t.id}')">✏️ Editar</button>
        <button class="btn btn-danger btn-sm" onclick="delTpl('${t.id}')">🗑 Eliminar</button>
      </div>
    </div>`;
  }).join('');
  grid.appendChild(empty);
}

// ── Modal: Nueva/Editar Plantilla ───────────────────────────
function showCreateTemplate() {
  try {
    document.getElementById('tplName').value  = '';
    document.getElementById('tplNiche').value = '';
    State.selectedEmoji = '🚀';
    document.querySelectorAll('.emoji-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    const list = document.getElementById('tplMessageList');
    if (list) { list.innerHTML = ''; tplMsgCount = 0; addTplMessage(); }
    openModal('templateModal');
  } catch(err) {
    console.error('showCreateTemplate error:', err);
    showToast('error', 'Error al abrir plantilla', err.message);
  }
}

let tplMsgCount = 0;

function addTplMessage() {
  const list = document.getElementById('tplMessageList');
  if (!list) return;
  const idx = ++tplMsgCount;
  const num = list.children.length + 1;
  const showRemove = list.children.length > 0;

  const div = document.createElement('div');
  div.className = 'send-step';
  div.dataset.tplIdx = String(idx);
  div.innerHTML = `
    <div class="step-badge msg-badge">💬 ${num}º · Mensaje</div>
    <div class="step-content">
      <div class="variable-buttons" style="margin-bottom:6px;flex-wrap:wrap;display:flex;gap:4px;align-items:center">
        <button type="button" class="var-btn" onclick="insertTplVar(${idx},'{nombre}')">+Nombre</button>
        <button type="button" class="var-btn" onclick="insertTplVar(${idx},'{negocio}')">+Negocio</button>
        <button type="button" class="var-btn" onclick="insertTplVar(${idx},'{nicho}')">+Nicho</button>
        <button type="button" class="var-btn" onclick="insertTplVar(${idx},'{ciudad}')">+Ciudad</button>
        ${showRemove ? `<button type="button" class="btn btn-danger btn-sm" style="margin-left:auto" onclick="removeTplMessage(this)">✕ Quitar</button>` : ''}
      </div>
      <textarea class="step-textarea tpl-ta" data-tpl-step="${idx}" rows="5"
        placeholder="Escribe el mensaje ${num}…&#10;Variables: {nombre} {negocio} {nicho} {ciudad}&#10;Spintax: {Hola|Buen día|Qué tal}"
        oninput="updateTplPreview(${idx})"></textarea>
      <div class="step-preview">
        <div class="wa-bubble step-preview-bubble" id="tplPreview${idx}">Vista previa…</div>
      </div>
    </div>`;

  list.appendChild(div);
  renumberTplSteps();
}

function removeTplMessage(btn) {
  btn.closest('.send-step').remove();
  renumberTplSteps();
}

function renumberTplSteps() {
  document.querySelectorAll('#tplMessageList .send-step').forEach((s, i) => {
    const b  = s.querySelector('.step-badge');
    const ta = s.querySelector('.tpl-ta');
    if (b)  b.textContent   = `💬 ${i + 1}º · Mensaje`;
    if (ta) ta.placeholder  = `Escribe el mensaje ${i + 1}…`;
  });
}

function insertTplVar(idx, variable) {
  const ta = document.querySelector(`textarea[data-tpl-step="${idx}"]`);
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + variable + ta.value.slice(e);
  ta.focus(); ta.selectionStart = ta.selectionEnd = s + variable.length;
  updateTplPreview(idx);
}

function updateTplPreview(idx) {
  const ta  = document.querySelector(`textarea[data-tpl-step="${idx}"]`);
  const out = document.getElementById(`tplPreview${idx}`);
  if (ta && out) out.innerHTML = esc(ta.value).replace(/\n/g, '<br>') || 'Vista previa…';
}

function getTplMessages() {
  const msgs = [];
  document.querySelectorAll('#tplMessageList .tpl-ta').forEach(ta => {
    if (ta.value.trim()) msgs.push(ta.value.trim());
  });
  return msgs;
}

function selectEmoji(btn, emoji) {
  State.selectedEmoji = emoji;
  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function saveTemplate() {
  const name  = (document.getElementById('tplName')?.value || '').trim();
  const niche = (document.getElementById('tplNiche')?.value || '').trim();
  if (!name) return showToast('warning', 'Campo requerido', 'Nombre de plantilla');

  const messages = getTplMessages();
  if (!messages.length) return showToast('warning', 'Campo requerido', 'Escribe al menos un mensaje');

  try {
    await postJSON('/api/templates', {
      name, niche,
      messages,
      message: messages[0],
      emoji: State.selectedEmoji || '🚀'
    });
    closeModal('templateModal');
    await fetchTemplates();
    showToast('success', '✅ Plantilla guardada', `${name} · ${messages.length} mensaje(s)`);
  } catch (e) {
    showToast('error', 'Error al guardar plantilla', e.message);
  }
}

function editTpl(id) {
  const t = State.templates.find(x => x.id === id);
  if (!t) return;
  document.getElementById('tplName').value  = t.name  || '';
  document.getElementById('tplNiche').value = t.niche || '';
  State.selectedEmoji = t.emoji || '🚀';
  document.querySelectorAll('.emoji-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === State.selectedEmoji);
  });

  document.getElementById('tplMessageList').innerHTML = '';
  tplMsgCount = 0;
  const msgs = Array.isArray(t.messages) && t.messages.length ? t.messages : [t.message||''];
  msgs.forEach(m => {
    addTplMessage();
    const last = document.querySelector(`textarea[data-tpl-step="${tplMsgCount}"]`);
    if (last) { last.value = m; updateTplPreview(tplMsgCount); }
  });
  openModal('templateModal');
}

async function delTpl(id) {
  if (!confirm('¿Eliminar esta plantilla?')) return;
  await fetch(`/api/templates/${id}`, { method: 'DELETE' });
  await fetchTemplates();
  showToast('success', 'Plantilla eliminada');
}

// ════════════════════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// WHATSAPP (MULTI-SESSIONS)
// ════════════════════════════════════════════════════════════
let waSessions = [];

async function fetchWAStatus() {
  try {
    waSessions = await getJSON('/api/whatsapp/sessions');
    renderSessions();
    
    // Actualizar selector global de workspace
    const wsSelect = document.getElementById('workspaceSelect');
    if (wsSelect) {
      const currentVal = wsSelect.value || State.currentSessionId;
      wsSelect.innerHTML = waSessions.map(s => `<option value="${s.sessionId}">${s.sessionId} ${s.connected ? '(Activo)' : '(Inactivo)'}</option>`).join('');
      if (waSessions.some(s => s.sessionId === currentVal)) wsSelect.value = currentVal;
    }
    
    // Actualizar sidebar status
    const currentSess = waSessions.find(s => s.sessionId === State.currentSessionId) || waSessions[0];
    updateSidebarWAStatus(currentSess);
  } catch (e) {
    console.warn('Error fetching wa sessions', e);
  }
}

function updateSidebarWAStatus(s) {
  const ok = s && s.connected;
  ['statusDot','qrDot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = `status-dot ${ok?'connected':''}`;
  });
  setText('statusLabel',   ok ? (s.name||s.phone||'Conectado') : 'Desconectado');
  setText('waStatusText',  ok ? `✓ ${s.name||s.phone||'Conectado'}` : 'Conectar WhatsApp');
  const waDot = document.getElementById('waDot');
  if (waDot) waDot.className = `wa-dot ${ok?'connected':''}`;
}

// ── State for WA viewer ──────────────────────────────────────
let waViewerSessionId = null;
let waViewerAllChats  = [];
let waViewerActiveChatId = null;

function renderSessions() {
  const grid = document.getElementById('sessionsGrid');
  if (!grid) return;

  if (!waSessions || waSessions.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-3)">
      <p>No hay sesiones inicializadas.</p>
      <button class="btn btn-primary" style="margin-top:12px" onclick="createNewSession()">+ Conectar primer número</button>
    </div>`;
    return;
  }

  grid.innerHTML = waSessions.map(s => buildSessionCard(s)).join('');
}

function buildSessionCard(s) {
  const ok = s.connected;

  // Status ribbon
  const ribbon = ok
    ? `<div class="sess-ribbon connected"><span class="live-dot"></span>Activo</div>`
    : `<div class="sess-ribbon disconnected">Desconectado</div>`;

  // Avatar / icon
  const avatar = ok
    ? `<div class="sess-avatar connected"><svg viewBox="0 0 32 32" width="32" height="32" fill="none"><circle cx="16" cy="16" r="15" fill="#25D366"/><path d="M23 20c-.3-.1-1.8-.9-2-.9s-.5-.1-.7.2-.8 1-1 1.2-.4.2-.7 0c-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5s-.7-1.7-1-2.3c-.2-.5-.5-.5-.7-.5h-.5c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.2.2 2.1 3.2 5 4.5.7.3 1.3.5 1.7.7.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4z" fill="white"/></svg></div>`
    : `<div class="sess-avatar disconnected"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><path d="M4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.5"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>`;

  let body = '';
  if (ok) {
    body = `
      <div class="sess-info">
        <div class="sess-name">${esc(s.name || 'Sin nombre')}</div>
        <div class="sess-phone">+${esc(s.phone || '—')}</div>
        <div class="sess-id-chip">${esc(s.sessionId)}</div>
      </div>
      <div class="sess-actions">
        <button class="btn btn-primary btn-sm" onclick="openWaViewer('${s.sessionId}','${esc(s.name||s.phone||s.sessionId)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ver WhatsApp
        </button>
        <button class="btn btn-danger btn-sm" onclick="logoutWhatsApp('${s.sessionId}')">Desconectar</button>
        <button class="btn btn-sm" style="background:rgba(37,211,102,.15);color:#4ade80;border:1px solid rgba(37,211,102,.35);" onclick="openWaScreen('${s.sessionId}','${esc(s.name||s.phone||s.sessionId)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          Pantalla en Vivo
        </button>
      </div>`;
  } else if (s.qr) {
    body = `
      <div class="sess-qr-wrap">
        <div class="sess-qr-glow"></div>
        <img src="${s.qr}" class="sess-qr-img" alt="QR Code" />
      </div>
      <p class="sess-qr-hint">Escanea con tu WhatsApp</p>
      <div class="sess-qr-steps">
        <span>Ajustes</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="m9 18 6-6-6-6"/></svg>
        <span>Dispositivos vinculados</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="m9 18 6-6-6-6"/></svg>
        <span>Vincular dispositivo</span>
      </div>`;
  } else {
    body = `
      <div class="sess-loading">
        <div class="sess-loading-ring"></div>
        <span>Generando QR…</span>
      </div>`;
  }

  return `
    <div class="sess-card ${ok ? 'connected' : s.qr ? 'qr' : 'loading'}">
      ${ribbon}
      ${avatar}
      ${body}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// WHATSAPP VIEWER (live)
// ════════════════════════════════════════════════════════════
async function openWaViewer(sessionId, displayName) {
  waViewerSessionId    = sessionId;
  waViewerActiveChatId = null;
  waViewerAllChats     = [];

  document.getElementById('waViewerTitle').textContent    = displayName || sessionId;
  document.getElementById('waViewerSubtitle').textContent = sessionId;
  document.getElementById('waChatSearch').value           = '';
  document.getElementById('waMessagesPanel').innerHTML    = `<div class="waviewer-welcome">
    <div class="waviewer-welcome-icon"><svg viewBox="0 0 64 64" fill="none" width="72" height="72"><circle cx="32" cy="32" r="30" fill="rgba(37,211,102,0.1)" stroke="rgba(37,211,102,0.25)" stroke-width="1.5"/></svg></div>
    <h3>Selecciona una conversación</h3>
    <p>Haz clic en cualquier chat de la izquierda para ver los mensajes</p>
  </div>`;
  document.getElementById('waChatList').innerHTML = `<div class="waviewer-empty-chats"><div class="waviewer-spinner"></div><span>Cargando chats…</span></div>`;
  document.getElementById('waViewerModal').classList.remove('hidden');

  // Register socket listener for this session's incoming messages
  if (socket) {
    socket.off(`whatsapp:message:${sessionId}`);
    socket.on(`whatsapp:message:${sessionId}`, (msg) => {
      if (msg.from === waViewerActiveChatId || msg.from + '@c.us' === waViewerActiveChatId) {
        appendWaMessage(msg);
      }
      // bump chat to top in sidebar
      const ci = waViewerAllChats.findIndex(c => c.id === msg.from || c.id === msg.from + '@c.us');
      if (ci > -1) {
        waViewerAllChats[ci].lastMessage = { body: msg.body, fromMe: false, timestamp: msg.timestamp };
        const moved = waViewerAllChats.splice(ci, 1)[0];
        waViewerAllChats.unshift(moved);
        renderWaChatList(waViewerAllChats);
      }
    });
    socket.off(`whatsapp:message_sent:${sessionId}`);
    socket.on(`whatsapp:message_sent:${sessionId}`, (msg) => {
      if (msg.from === waViewerActiveChatId) appendWaMessage(msg);
    });
    socket.off(`whatsapp:chats:${sessionId}`);
    socket.on(`whatsapp:chats:${sessionId}`, ({ chats }) => {
      waViewerAllChats = chats;
      renderWaChatList(chats);
    });
  }

  await refreshWaChats();
}

function closeWaViewer() {
  document.getElementById('waViewerModal').classList.add('hidden');
  if (socket && waViewerSessionId) {
    socket.off(`whatsapp:message:${waViewerSessionId}`);
    socket.off(`whatsapp:message_sent:${waViewerSessionId}`);
    socket.off(`whatsapp:chats:${waViewerSessionId}`);
  }
  waViewerSessionId = null;
}

async function refreshWaChats() {
  if (!waViewerSessionId) return;
  try {
    const r = await getJSON(`/api/whatsapp/sessions/${waViewerSessionId}/chats`);
    waViewerAllChats = r.chats || [];
    renderWaChatList(waViewerAllChats);
  } catch(e) {
    document.getElementById('waChatList').innerHTML = `<div class="waviewer-empty-chats"><span style="color:#f87171">Error al cargar chats</span></div>`;
  }
}

function renderWaChatList(chats) {
  const el = document.getElementById('waChatList');
  if (!el) return;
  if (!chats || !chats.length) {
    el.innerHTML = `<div class="waviewer-empty-chats"><span>No hay conversaciones aún</span></div>`;
    return;
  }
  el.innerHTML = chats.map(c => {
    const lastMsg  = c.lastMessage;
    const preview  = lastMsg ? (lastMsg.fromMe ? '✓ ' : '') + (lastMsg.body || '📎 Archivo').slice(0, 50) : 'Sin mensajes';
    const timeStr  = lastMsg ? fmtWaTime(lastMsg.timestamp) : '';
    const unread   = c.unreadCount > 0 ? `<span class="wa-unread-badge">${c.unreadCount > 99 ? '99+' : c.unreadCount}</span>` : '';
    const initials = (c.name || c.id || '?').slice(0, 2).toUpperCase();
    const isActive = c.id === waViewerActiveChatId;
    // Store chatId in data attribute to avoid escaping issues with onclick
    const safeName = (c.name || c.id || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<div class="waviewer-chat-item ${isActive ? 'active' : ''}" data-chatid="${esc(c.id)}" onclick="openWaChat(this.dataset.chatid,'${safeName}')">
      <div class="wa-avatar-wrap">
        ${c.avatarUrl
          ? `<img src="${c.avatarUrl}" class="wa-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="wa-avatar-initials" style="display:none">${initials}</div>`
          : `<div class="wa-avatar-initials">${initials}</div>`}
        ${c.isGroup ? '<span class="wa-group-badge">G</span>' : ''}
      </div>
      <div class="wa-chat-info">
        <div class="wa-chat-top">
          <span class="wa-chat-name">${esc(c.name || c.id)}</span>
          <span class="wa-chat-time">${timeStr}</span>
        </div>
        <div class="wa-chat-bottom">
          <span class="wa-chat-preview">${esc(preview)}</span>
          ${unread}
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterWaChats(q) {
  const filtered = q ? waViewerAllChats.filter(c => (c.name || c.id).toLowerCase().includes(q.toLowerCase())) : waViewerAllChats;
  renderWaChatList(filtered);
}

async function openWaChat(chatId, chatName) {
  waViewerActiveChatId = chatId;

  // Mark active in sidebar using data attribute
  document.querySelectorAll('.waviewer-chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatid === chatId);
  });

  const initials = (chatName || '?').slice(0, 2).toUpperCase();
  const panel = document.getElementById('waMessagesPanel');
  panel.innerHTML = `<div class="waviewer-msg-header">
    <div class="wa-avatar-initials" style="width:40px;height:40px;font-size:.9rem;flex-shrink:0">${initials}</div>
    <div style="min-width:0">
      <div style="font-weight:700;font-size:.95rem;color:#e9edef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(chatName)}</div>
      <div style="font-size:.72rem;color:#8696a0">${chatId}</div>
    </div>
  </div>
  <div class="waviewer-msg-list" id="waMsgList"><div class="waviewer-empty-chats"><div class="waviewer-spinner"></div><span>Cargando mensajes…</span></div></div>`;

  try {
    // chatId via query param para evitar problemas con @c.us
    const url = `/api/whatsapp/sessions/${encodeURIComponent(waViewerSessionId)}/messages?chatId=${encodeURIComponent(chatId)}`;
    const r = await getJSON(url);
    const msgs = r.messages || [];
    const msgList = document.getElementById('waMsgList');
    if (!msgList) return;
    if (!msgs.length) {
      msgList.innerHTML = `<div class="waviewer-empty-chats"><span style="color:#8696a0">Esta conversación no tiene mensajes cargados aún.<br><small>Intenta abrir WhatsApp en el teléfono primero.</small></span></div>`;
      return;
    }
    msgList.innerHTML = msgs.map(m => buildWaBubble(m)).join('');
    msgList.scrollTop = msgList.scrollHeight;
  } catch(e) {
    const ml = document.getElementById('waMsgList');
    if (ml) ml.innerHTML = `<div class="waviewer-empty-chats" style="color:#f87171">Error: ${esc(e.message)}</div>`;
  }
}

function buildWaBubble(m) {
  const time = m.timestamp ? new Date(m.timestamp * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
  const side = m.fromMe ? 'out' : 'in';
  const text = m.type === 'chat' || m.type === 'text'
    ? esc(m.body || '').replace(/\n/g, '<br>')
    : `<span style="color:var(--text-3);font-style:italic">📎 ${esc(m.type || 'archivo')}</span>`;
  return `<div class="wa-bubble-row ${side}">
    <div class="wa-bubble ${side}">
      <div class="wa-bubble-text">${text}</div>
      <div class="wa-bubble-time">${time}${m.fromMe ? ' ✓✓' : ''}</div>
    </div>
  </div>`;
}

function appendWaMessage(m) {
  const list = document.getElementById('waMsgList');
  if (!list) return;
  const div = document.createElement('div');
  div.innerHTML = buildWaBubble(m);
  list.appendChild(div.firstElementChild);
  list.scrollTop = list.scrollHeight;
}

function fmtWaTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' });
}

async function createNewSession() {
  const newId = prompt('Ingresa un nombre corto para esta nueva línea (ej: session-2 o ventas):');
  if (!newId) return;
  const safeId = newId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  showToast('info', 'Iniciando', `Preparando línea ${safeId}...`);
  await postJSON(`/api/whatsapp/sessions/${safeId}/init`, {});
  fetchWAStatus();
}

async function logoutWhatsApp(sessionId) {
  if (!confirm(`¿Desconectar línea ${sessionId}?`)) return;
  await fetch(`/api/whatsapp/sessions/${sessionId}/logout`, { method:'POST' });
  showToast('info', `WhatsApp desconectado: ${sessionId}`);
  fetchWAStatus();
}

// ════════════════════════════════════════════════════════════
// UPLOAD DE IMAGEN
// ════════════════════════════════════════════════════════════
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('info', 'Subiendo…', file.name);
  const fd = new FormData();
  fd.append('image', file);
  try {
    const d = await (await fetch('/api/upload', { method:'POST', body:fd })).json();
    State.uploadedImage = d.url;
    document.getElementById('imageUploadArea')?.classList.add('hidden');
    document.getElementById('uploadedImagePreview')?.classList.remove('hidden');
    const img = document.getElementById('uploadedImg');
    if (img) img.src = d.url;
    showToast('success', '✅ Imagen lista');
  } catch (err) { showToast('error', 'Error al subir', err.message); }
}
function removeUploadedImage() {
  State.uploadedImage = null;
  document.getElementById('imageUploadArea')?.classList.remove('hidden');
  document.getElementById('uploadedImagePreview')?.classList.add('hidden');
  const ci = document.getElementById('campImage');
  if (ci) ci.value = '';
}

// ════════════════════════════════════════════════════════════
// ACTIVIDAD
// ════════════════════════════════════════════════════════════
const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  send:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/></svg>',
  reply:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  done:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  error:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};
const ICON_COLORS = { search:'purple', send:'green', reply:'purple', done:'green', error:'orange' };

function addActivity(type, text) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'activity-item';
  div.innerHTML = `
    <div class="activity-icon ${ICON_COLORS[type]||'purple'}">${ICONS[type]||ICONS.send}</div>
    <div><p class="activity-text">${esc(text)}</p><span class="activity-time">${new Date().toLocaleTimeString('es')}</span></div>`;
  feed.insertBefore(div, feed.firstChild);
  while (feed.children.length > 15) feed.removeChild(feed.lastChild);
}

function markProspectReplied(from) {
  const phone = from.replace('@c.us', '');
  const p = State.prospects.find(x => (x.phone||'').replace(/\D/g,'').endsWith(phone));
  if (p && p.status === 'contacted') {
    postJSON(`/api/prospects/${p.id}`, { status:'replied' }, 'PUT').catch(()=>{});
    p.status = 'replied';
    renderProspects();
  }
}

// ════════════════════════════════════════════════════════════
// MODALS
// ════════════════════════════════════════════════════════════
function openModal(id)  {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
});

// ════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/></svg>'
};
function showToast(type, title, msg='') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${TOAST_ICONS[type]||TOAST_ICONS.info}</div>
    <div class="toast-text"><span class="toast-title">${esc(title)}</span>${msg?`<span class="toast-msg">${esc(msg)}</span>`:''}</div>`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => {
    t.style.cssText = 'opacity:0;transform:translateX(20px);transition:all .3s ease';
    setTimeout(() => t.remove(), 300);
  }, 4000);

  // Agregar al centro de notificaciones si no es silencioso
  addNotification(type, title, msg);
}

// ════════════════════════════════════════════════════════════
// NOTIFICACIONES PANEL
// ════════════════════════════════════════════════════════════
function toggleNotifications() {
  const panel = document.getElementById('notificationsPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    markNotificationsRead();
  }
}

function addNotification(type, title, message) {
  const notif = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    type: type === 'warning' ? 'warning' : (type === 'error' ? 'error' : (type === 'success' ? 'success' : 'info')),
    title: title || '',
    message: message || '',
    time: new Date(),
    read: false
  };
  State.notifications.unshift(notif);
  if (State.notifications.length > 200) State.notifications.pop();
  
  updateNotificationsUI();
}

function updateNotificationsUI() {
  const list = document.getElementById('notificationsList');
  const dot = document.getElementById('notifyDot');
  if (!list || !dot) return;
  
  const unread = State.notifications.filter(n => !n.read).length;
  if (unread > 0) {
    dot.textContent = unread > 99 ? '99+' : unread;
    dot.classList.remove('hidden');
  } else {
    dot.classList.add('hidden');
  }

  let display = State.notifications;
  if (State.notifFilter !== 'all') {
    display = display.filter(n => n.type === State.notifFilter);
  }

  if (display.length === 0) {
    list.innerHTML = `
      <div class="empty-state-sm" style="flex-direction:column; padding: 40px 20px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="margin-bottom:10px;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <p>No hay notificaciones</p>
      </div>`;
    return;
  }

  const icons = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };

  list.innerHTML = display.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-icon ${n.type}">${icons[n.type] || icons.info}</div>
      <div class="notif-content">
        <div class="notif-title">${esc(n.title)}</div>
        ${n.message ? `<div class="notif-message">${esc(n.message)}</div>` : ''}
        <span class="notif-time">${n.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} · ${n.time.toLocaleDateString()}</span>
      </div>
    </div>
  `).join('');
}

function filterNotifs(type) {
  State.notifFilter = type;
  document.querySelectorAll('.notif-filter').forEach(btn => btn.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');
  updateNotificationsUI();
}

function clearNotifications() {
  State.notifications = [];
  updateNotificationsUI();
}

function markNotificationsRead() {
  let changed = false;
  State.notifications.forEach(n => {
    if (!n.read) { n.read = true; changed = true; }
  });
  if (changed) updateNotificationsUI();
}

// Interceptar window clicks para cerrar panel
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notificationsPanel');
  const btn = document.getElementById('notifyBtn');
  if (panel && !panel.classList.contains('hidden')) {
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.add('hidden');
      markNotificationsRead();
    }
  }
});


// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}) : '—';
}
function statusLbl(s) { return ({new:'Nuevo',contacted:'Contactado',replied:'Respondió',converted:'Convertido',queued:'En Cola'}[s]||'Nuevo'); }
function campLbl(s)   { return ({draft:'Borrador',running:'● En vivo',completed:'✓ Completada',paused:'⏸ Pausada',scheduled:'⏰ Programada'}[s]||s); }
function stars(r)     { r = Math.round(parseFloat(r)||0); return '★'.repeat(r) + '☆'.repeat(5-r); }
function scoreCls(s)  { return s>=70 ? 'score-high' : s>=50 ? 'score-med' : 'score-low'; }

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}
async function postJSON(url, body, method='POST') {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || r.statusText); }
  return r.json();
}

// CSS extra inline
document.head.insertAdjacentHTML('beforeend', `<style>
  /* ── Spinner / Pagination ── */
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinning{animation:spin 1s linear infinite}
  .pagination{display:flex;align-items:center;gap:8px;padding:14px 16px;border-top:1px solid var(--border);flex-wrap:wrap}
  .pag-btn{padding:5px 10px;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;color:var(--text-2);cursor:pointer;font-size:.78rem;transition:all .2s}
  .pag-btn:hover:not(:disabled){border-color:var(--purple);color:var(--purple-light)}
  .pag-btn:disabled{opacity:.4;cursor:default}
  .pag-info{font-size:.78rem;color:var(--text-2);flex:1;text-align:center}
  .tag-yes{color:var(--green-2);font-weight:700}
  .prospect-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .detail-field{display:flex;flex-direction:column;gap:3px}
  .detail-field label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3)}
  .detail-field span{font-size:.85rem;color:var(--text)}
  .detail-field a{color:var(--purple-light);text-decoration:none}
  .detail-field a:hover{text-decoration:underline}
  .rating-stars{color:#f59e0b;letter-spacing:1px}

  /* ── Session Cards ── */
  .sess-card{position:relative;background:var(--bg-2);border:1px solid var(--border);border-radius:18px;padding:28px 24px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;transition:box-shadow .3s,transform .3s;overflow:hidden}
  .sess-card:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,0,0,.35)}
  .sess-card.connected{border-color:rgba(34,197,94,.35)}
  .sess-card.connected:hover{box-shadow:0 12px 40px rgba(34,197,94,.15)}
  .sess-card.qr{border-color:rgba(99,102,241,.35)}
  .sess-ribbon{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;position:absolute;top:16px;right:16px}
  .sess-ribbon.connected{background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3)}
  .sess-ribbon.disconnected{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)}
  .sess-avatar{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .sess-avatar.connected{background:rgba(37,211,102,.12);box-shadow:0 0 0 4px rgba(37,211,102,.15)}
  .sess-avatar.disconnected{background:rgba(255,255,255,.05)}
  .sess-info{text-align:center}
  .sess-name{font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:4px}
  .sess-phone{font-size:.85rem;color:var(--text-2);margin-bottom:8px}
  .sess-id-chip{display:inline-block;padding:3px 10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:20px;font-size:.72rem;color:var(--purple-light);font-family:monospace}
  .sess-actions{display:flex;gap:8px;width:100%;justify-content:center;flex-wrap:wrap;margin-top:4px}
  .sess-qr-wrap{position:relative;padding:8px;background:#fff;border-radius:12px}
  .sess-qr-glow{position:absolute;inset:-6px;border-radius:16px;background:linear-gradient(135deg,rgba(99,102,241,.4),rgba(168,85,247,.4));z-index:-1;filter:blur(8px)}
  .sess-qr-img{width:100%;max-width:190px;border-radius:8px;display:block}
  .sess-qr-hint{font-size:.82rem;color:var(--text-2);text-align:center}
  .sess-qr-steps{display:flex;align-items:center;gap:4px;font-size:.7rem;color:var(--text-3);flex-wrap:wrap;justify-content:center}
  .sess-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;color:var(--text-3);font-size:.85rem}
  @keyframes ring-spin{to{transform:rotate(360deg)}}
  .sess-loading-ring{width:40px;height:40px;border:3px solid rgba(99,102,241,.2);border-top-color:#6366f1;border-radius:50%;animation:ring-spin 1s linear infinite}


</style>`);


// ═══════════════════════════════════════════════════════════
// WA LIVE SCREEN — Socket.IO streaming viewer
// ═══════════════════════════════════════════════════════════
let _waSc = { sessId:null, active:false, paused:false, vp:{w:1280,h:800}, lastTs:0 };

function openWaScreen(sessionId, displayName) {
  _waSc.sessId  = sessionId;
  _waSc.active  = true;
  _waSc.paused  = false;
  _waSc.lastTs  = 0;
  document.getElementById('waScreenTitle').textContent = (displayName||sessionId) + ' — WhatsApp Web';
  document.getElementById('waScreenFps').textContent   = '';
  document.getElementById('waScreenLoading').style.display = 'flex';
  document.getElementById('waScreenImg').style.display     = 'none';
  document.getElementById('waScreenInput').value = '';
  document.getElementById('waScreenModal').classList.remove('hidden');
  if (socket) {
    socket.off('screen:frame:' + sessionId);
    socket.on('screen:frame:' + sessionId, function(d) {
      if (!_waSc.active || _waSc.paused) return;
      var el = document.getElementById('waScreenImg');
      if (!el) return;
      el.src = d.img; el.style.display = 'block';
      document.getElementById('waScreenLoading').style.display = 'none';
      var now = Date.now();
      if (_waSc.lastTs) document.getElementById('waScreenFps').textContent = Math.round(1000/(now-_waSc.lastTs)) + ' fps';
      _waSc.lastTs = now;
    });
    socket.emit('screen:subscribe', { sessionId: sessionId });
  }
}

function closeWaScreen() {
  _waSc.active = false;
  if (socket && _waSc.sessId) { socket.emit('screen:unsubscribe'); socket.off('screen:frame:' + _waSc.sessId); }
  _waSc.sessId = null;
  document.getElementById('waScreenModal').classList.add('hidden');
}

function waScreenTogglePause() {
  _waSc.paused = !_waSc.paused;
  document.getElementById('waScreenPauseBtn').textContent = _waSc.paused ? '▶ Reanudar' : '⏸ Pausar';
}

function waScreenRefresh() {
  if (socket && _waSc.sessId) { socket.emit('screen:unsubscribe'); socket.emit('screen:subscribe',{sessionId:_waSc.sessId}); }
}

function _waScCoords(e) {
  var img = document.getElementById('waScreenImg'), rect = img.getBoundingClientRect();
  return { x: Math.round((e.clientX-rect.left)/rect.width*_waSc.vp.w), y: Math.round((e.clientY-rect.top)/rect.height*_waSc.vp.h) };
}

async function handleWaScreenClick(e) {
  e.preventDefault();
  if (!_waSc.sessId) return;
  var c = _waScCoords(e);
  try { await postJSON('/api/whatsapp/sessions/'+_waSc.sessId+'/screen/click',{x:c.x,y:c.y}); } catch(err){}
}

async function handleWaScreenScroll(e) {
  e.preventDefault();
  if (!_waSc.sessId) return;
  var c = _waScCoords(e);
  try { await postJSON('/api/whatsapp/sessions/'+_waSc.sessId+'/screen/scroll',{x:c.x,y:c.y,deltaY:e.deltaY}); } catch(err){}
}

async function waScreenKey(key) {
  if (!_waSc.sessId) return;
  try { await postJSON('/api/whatsapp/sessions/'+_waSc.sessId+'/screen/keyboard',{key:key}); } catch(err){}
}

async function waScreenTypeText() {
  var input = document.getElementById('waScreenInput'), text = (input.value||'').trim();
  if (!text||!_waSc.sessId) return;
  try { await postJSON('/api/whatsapp/sessions/'+_waSc.sessId+'/screen/keyboard',{text:text}); input.value=''; } catch(err){}
}

function handleWaScreenKeydown(e) { if(e.key==='Enter'){e.preventDefault();waScreenTypeText();} }
