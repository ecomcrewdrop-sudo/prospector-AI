'use strict';

/**
 * instagramModule.js — Prospección via Instagram Graph API
 *
 * Flujo:
 *  1. Generar hashtags relevantes (niche + ciudad)
 *  2. Para cada hashtag → obtener posts recientes → extraer usernames únicos
 *  3. Para cada username → Business Discovery API → perfil completo
 *  4. Extraer teléfono / email / website del bio
 *  5. Calcular score y devolver prospectos listos para importar
 */

const { v4: uuidv4 } = require('uuid');
const IG_BASE = 'https://graph.facebook.com/v19.0';

// ── Leer credenciales desde DB o env ─────────────────────────
function getCreds() {
  const db = global.db;
  const token  = process.env.INSTAGRAM_ACCESS_TOKEN
    || db?.prepare("SELECT value FROM settings WHERE key = 'instagram_access_token'").get()?.value;
  const userId = process.env.INSTAGRAM_USER_ID
    || db?.prepare("SELECT value FROM settings WHERE key = 'instagram_user_id'").get()?.value;
  if (!token || !userId) throw new Error('Configura el Access Token y el User ID de Instagram en Ajustes → Instagram');
  return { token, userId };
}

// ── Fetch con timeout ─────────────────────────────────────────
async function igFetch(url, params = {}) {
  const { token, userId } = getCreds();
  const qs = new URLSearchParams({ access_token: token, ...params }).toString();
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${url}?${qs}`, { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json();
    if (json.error) throw new Error(`IG API: ${json.error.message} (code ${json.error.code})`);
    return json;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ── 1. Buscar ID de hashtag ───────────────────────────────────
const hashtagCache = new Map(); // evitar re-buscar el mismo hashtag

async function getHashtagId(hashtag) {
  const tag = hashtag.replace(/^#/, '').toLowerCase();
  if (hashtagCache.has(tag)) return hashtagCache.get(tag);

  const { userId } = getCreds();
  const data = await igFetch(`${IG_BASE}/ig_hashtag_search`, { user_id: userId, q: tag });
  const id = data?.data?.[0]?.id || null;
  if (id) hashtagCache.set(tag, id);
  return id;
}

// ── 2. Posts recientes de un hashtag ─────────────────────────
async function getHashtagMedia(hashtagId, limit = 50) {
  const { userId } = getCreds();
  const data = await igFetch(`${IG_BASE}/${hashtagId}/recent_media`, {
    user_id: userId,
    fields:  'id,caption,media_type,permalink,timestamp,username,like_count,comments_count',
    limit:   Math.min(limit, 50),
  });
  return data?.data || [];
}

// ── 3. Perfil de negocio por username (Business Discovery) ────
async function getBusinessProfile(username) {
  const { userId } = getCreds();
  try {
    const data = await igFetch(`${IG_BASE}/${userId}`, {
      fields:   'business_discovery.fields(username,name,biography,followers_count,follows_count,media_count,website,profile_picture_url)',
      username, // el username a descubrir
    });
    return data?.business_discovery || null;
  } catch (e) {
    // Cuentas personales o privadas no son accesibles — ignorar silenciosamente
    if (e.message?.includes('100') || e.message?.includes('803')) return null;
    throw e;
  }
}

// ── 4. Extracción de contacto del bio ────────────────────────
function extractContact(bio = '', website = '') {
  // Teléfono colombiano: 3XXXXXXXXX o +573XXXXXXXXX o wa.me/57...
  const phoneMatch =
    bio.match(/wa\.me\/(\d{10,13})/) ||
    bio.match(/whatsapp[:\s.]+(\+?57[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i) ||
    bio.match(/(\+?57[\s.-]?)?(?<!\d)(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/);

  let phone = null;
  if (phoneMatch) {
    phone = (phoneMatch[1] || phoneMatch[2] || '').replace(/[\s.()-]/g, '');
    if (phone.length === 10 && phone.startsWith('3')) phone = '57' + phone;
    if (phone.length < 7) phone = null;
  }

  const email = bio.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)?.[0] || null;

  // Website: del campo website o de la bio
  let web = website || null;
  if (!web) web = bio.match(/(?:https?:\/\/)?(?:www\.)?[\w-]{3,}\.[\w]{2,}(?:\/[\w?=&.%-]*)?/)?.[0] || null;
  if (web && !web.startsWith('http')) web = 'https://' + web;
  // Ignorar links genéricos de IG/linktree que no son sitio propio
  if (web && (web.includes('instagram.com') || web.includes('linktr.ee'))) web = null;

  return { phone, email, website: web };
}

// ── 5. Score del prospecto ────────────────────────────────────
function scoreProfile(profile, contact) {
  let score = 40;

  const followers = profile.followers_count || 0;
  if (followers >= 300)   score += 5;
  if (followers >= 1000)  score += 10;
  if (followers >= 5000)  score += 15;
  if (followers >= 20000) score += 5;  // demasiado grande = menos fácil

  if (contact.phone)   score += 25; // contactable directamente
  if (contact.email)   score += 8;
  if (contact.website) score += 10;

  const mediaCount = profile.media_count || 0;
  if (mediaCount >= 10)  score += 5;
  if (mediaCount >= 50)  score += 5;

  // Actividad reciente no disponible en este endpoint — bonus neutral
  return Math.min(Math.max(score, 1), 99);
}

// ── Generar hashtags por nicho + ciudad ───────────────────────
function buildHashtags(niche, city = '', extra = []) {
  const n = niche.toLowerCase().replace(/\s+/g, '');
  const c = city.toLowerCase().replace(/\s+/g, '');
  const tags = new Set([
    c ? `${n}${c}` : null,
    c ? `${n}en${c}` : null,
    `${n}colombia`,
    n,
    c ? `negocio${c}` : 'negociocolombia',
    c ? `emprendimiento${c}` : null,
    c ? `pyme${c}` : 'pymecolombia',
    ...extra,
  ].filter(Boolean));
  return [...tags].slice(0, 6); // máx 6 hashtags (límite de rate de IG)
}

// ── Pausa ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Búsqueda principal ────────────────────────────────────────
async function search({ niche, city = '', limit = 60, customHashtags = [], sessionId, onProgress }) {
  const hashtags = buildHashtags(niche, city, customHashtags);
  onProgress?.({ pct: 5, text: `🔍 Instagram: buscando hashtags para "${niche}"...` });

  const usernames = new Set();

  for (let i = 0; i < hashtags.length; i++) {
    const tag = hashtags[i];
    onProgress?.({ pct: 10 + (i / hashtags.length) * 30, text: `#${tag} — extrayendo posts...` });
    try {
      const hashtagId = await getHashtagId(tag);
      if (!hashtagId) { await sleep(400); continue; }

      const media = await getHashtagMedia(hashtagId, 50);
      for (const post of media) {
        if (post.username) usernames.add(post.username);
      }
      await sleep(600); // respetar rate limit
    } catch (e) {
      console.warn(`[IG] Hashtag #${tag}: ${e.message}`);
      await sleep(800);
    }
  }

  onProgress?.({ pct: 42, text: `👤 Analizando ${usernames.size} perfiles únicos...` });

  const targets = [...usernames].slice(0, limit);
  const prospects = [];
  let processed = 0;

  for (const username of targets) {
    processed++;
    const pct = 42 + Math.round((processed / targets.length) * 55);
    onProgress?.({ pct, text: `@${username} (${processed}/${targets.length})` });

    try {
      const profile = await getBusinessProfile(username);
      if (!profile) { await sleep(250); continue; }

      const contact = extractContact(profile.biography || '', profile.website || '');
      const score   = scoreProfile(profile, contact);

      prospects.push({
        id:          uuidv4(),
        name:        profile.name || username,
        instagram:   username,
        phone:       contact.phone || '',
        email:       contact.email || '',
        website:     contact.website || '',
        city:        city || '',
        niche:       niche || 'Negocio',
        hasWebsite:  !!contact.website,
        source:      'instagram',
        score,
        followers:   profile.followers_count || 0,
        bio:         profile.biography || '',
        sessionId,
        notes:       `Bio IG: ${(profile.biography || '').slice(0, 200)}`,
      });

      await sleep(300);
    } catch (e) {
      console.warn(`[IG] @${username}: ${e.message}`);
      await sleep(400);
    }
  }

  onProgress?.({ pct: 100, text: `✅ Instagram: ${prospects.length} negocios encontrados` });
  return prospects;
}

// ── Verificar credenciales ────────────────────────────────────
async function verifyCredentials() {
  const { userId } = getCreds();
  const data = await igFetch(`${IG_BASE}/${userId}`, {
    fields: 'id,username,name,account_type',
  });
  return data;
}

module.exports = { search, verifyCredentials, getBusinessProfile };
