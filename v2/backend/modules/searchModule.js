/**
 * SEARCH MODULE v2.1 — Multi-source prospect scraper
 * Sources: Google Maps | Páginas Amarillas | Facebook Business | Instagram Business
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const { randomUUID: uuidv4 } = require('crypto');
const os = require('os');
const path = require('path');

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const delay = ms => new Promise(r => setTimeout(r, ms));

function cacheGet(k) {
  const e = CACHE.get(k);
  if (!e || Date.now() - e.ts > CACHE_TTL) { CACHE.delete(k); return null; }
  // Devolver copias con nuevos UUIDs para no reutilizar IDs entre sesiones
  return e.data.map(p => ({ ...p, id: uuidv4() }));
}
function cacheSet(k, d) { CACHE.set(k, { data: d, ts: Date.now() }); }

const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' }
});

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
async function search({ query, location, maxResults = 20, sources = ['google_maps'], onProgress }) {
  const cacheKey = `${query}|${location}|${maxResults}|${sources.join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    onProgress?.({ pct: 100, text: '⚡ Resultado desde caché' });
    return cached;
  }

  let raw = [];
  const fetchTarget = Math.min(Math.ceil(maxResults * 1.6), 100);
  let pct = 5;

  // ── Google Maps ──────────────────────────────────────────────
  if (sources.includes('google_maps')) {
    onProgress?.({ pct: (pct = 10), text: '🗺️ Buscando en Google Maps...' });
    try {
      const gm = await searchGoogleMaps(query, location, fetchTarget, onProgress);
      raw = mergeSources(raw, gm);
      console.log(`[GMaps] ${gm.length} resultados`);
    } catch (e) { console.warn('[GMaps]', e.message); }

    if (raw.length < maxResults) {
      onProgress?.({ pct: (pct = 40), text: `🗺️ Segunda pasada Maps (${raw.length}/${maxResults})...` });
      try {
        const gm2 = await searchGoogleMaps(`${query} en ${location}`, location, fetchTarget - raw.length + 10, null);
        raw = mergeSources(raw, gm2);
      } catch {}
    }
  }

  // ── Páginas Amarillas ────────────────────────────────────────
  if (sources.includes('paginas_amarillas') && raw.length < maxResults) {
    onProgress?.({ pct: (pct = 48), text: `📒 Buscando en Páginas Amarillas (${raw.length}/${maxResults})...` });
    try {
      const pa = await searchPaginasAmarillas(query, location, maxResults - raw.length + 10);
      raw = mergeSources(raw, pa);
      console.log(`[PagAmarillas] +${pa.length} resultados`);
    } catch (e) { console.warn('[PagAmarillas]', e.message); }
  }

  // ── Facebook Business ────────────────────────────────────────
  if (sources.includes('facebook') && raw.length < maxResults) {
    onProgress?.({ pct: (pct = 55), text: `📘 Buscando negocios en Facebook (${raw.length}/${maxResults})...` });
    try {
      const fb = await searchFacebookBusiness(query, location, maxResults - raw.length + 10);
      raw = mergeSources(raw, fb);
      console.log(`[Facebook] +${fb.length} resultados`);
    } catch (e) { console.warn('[Facebook]', e.message); }
  }

  // ── Instagram Business ───────────────────────────────────────
  if (sources.includes('instagram') && raw.length < maxResults) {
    onProgress?.({ pct: (pct = 62), text: `📷 Buscando cuentas de negocio en Instagram (${raw.length}/${maxResults})...` });
    try {
      const ig = await searchInstagramBusiness(query, location, maxResults - raw.length + 10);
      raw = mergeSources(raw, ig);
      console.log(`[Instagram] +${ig.length} resultados`);
    } catch (e) { console.warn('[Instagram]', e.message); }
  }

  // ── OpenStreetMap (fallback final) ───────────────────────────
  if (raw.length < maxResults) {
    onProgress?.({ pct: (pct = 68), text: `🌍 Complementando con OpenStreetMap (${raw.length}/${maxResults})...` });
    try {
      const osm = await searchOverpass(query, location, maxResults - raw.length + 10);
      raw = mergeSources(raw, osm);
    } catch (e) { console.warn('[OSM]', e.message); }
  }

  // ── Enriquecimiento ──────────────────────────────────────────
  const toEnrich = raw.slice(0, maxResults);
  onProgress?.({ pct: 75, text: `✨ Enriqueciendo ${toEnrich.length} negocios...` });
  let done = 0;
  const enriched = await runConcurrent(toEnrich, async r => {
    const p = await enrichProspect(r, location);
    done++;
    onProgress?.({ pct: 75 + Math.round((done / toEnrich.length) * 20), text: `Procesando: ${r.name || '...'}` });
    return p;
  }, 4);

  const final = enriched.filter(Boolean);
  cacheSet(cacheKey, final);
  onProgress?.({ pct: 100, text: `✅ ${final.length} prospectos encontrados` });
  return final;
}

// ═══════════════════════════════════════════════════════════════
// FUENTE 1: GOOGLE MAPS — extracción paralela
// ═══════════════════════════════════════════════════════════════
async function searchGoogleMaps(query, location, maxResults, onProgress) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      userDataDir: path.join(os.tmpdir(), `puppeteer_gm_${uuidv4()}`),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,768'],
      defaultViewport: { width: 1366, height: 768 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());

    const url = `https://www.google.com/maps/search/${encodeURIComponent(query + ' ' + location)}?hl=es&gl=co`;
    onProgress?.({ pct: 15, text: `🔍 Abriendo Google Maps para "${query}"...` });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Aceptar cookies
    try {
      await page.waitForSelector('form button', { timeout: 4000 });
      const btns = await page.$$('form button');
      if (btns.length) await btns[btns.length - 1].click();
      await delay(800);
    } catch {}

    try { await page.waitForSelector('[role="feed"]', { timeout: 15000 }); }
    catch { return []; }

    onProgress?.({ pct: 22, text: '📋 Cargando lista de resultados...' });

    // Scroll hasta tener suficientes resultados
    let stuckCount = 0, prevCount = 0;
    for (let i = 0; i < 50; i++) {
      const count = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) { feed.scrollBy(0, 8000); feed.scrollTop = feed.scrollHeight; }
        return document.querySelectorAll('[role="feed"] a.hfpxzc').length;
      });
      if (count >= maxResults) break;
      if (count === prevCount) { if (++stuckCount >= 6) break; } else stuckCount = 0;
      prevCount = count;
      await delay(1000);
    }

    const placeLinks = await page.evaluate((max) =>
      [...document.querySelectorAll('[role="feed"] a.hfpxzc')]
        .slice(0, max)
        .map(a => ({ href: a.href, name: a.getAttribute('aria-label') || '' })),
      maxResults
    );

    if (!placeLinks.length) return [];
    onProgress?.({ pct: 28, text: `📍 ${placeLinks.length} negocios encontrados. Extrayendo...` });

    // Extracción paralela con pool de 4 páginas
    const CONCURRENCY = 4;
    const results = [];
    for (let i = 0; i < placeLinks.length; i += CONCURRENCY) {
      const batch = placeLinks.slice(i, i + CONCURRENCY);
      onProgress?.({
        pct: 28 + Math.round((i / placeLinks.length) * 42),
        text: `📊 Lote ${Math.floor(i / CONCURRENCY) + 1}: ${batch.map(b => b.name).join(', ').slice(0, 60)}...`
      });

      const batchResults = await Promise.all(batch.map(async link => {
        let detailPage;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            detailPage = await browser.newPage();
            await detailPage.setRequestInterception(true);
            detailPage.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());
            await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await detailPage.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await delay(attempt === 0 ? 1500 : 2500);

            const data = await detailPage.evaluate(() => {
              const q = sel => document.querySelector(sel);
              const name = q('h1.DUwDvf')?.textContent?.trim() || q('h1')?.textContent?.trim() || '';
              const ratingEl = q('div.F7nice span[aria-hidden="true"]') || q('span.ceNzKf');
              const rating = ratingEl?.textContent?.trim() || null;
              const reviewsEl = q('div.F7nice span[aria-label]');
              const reviews = (reviewsEl?.getAttribute('aria-label') || '').match(/[\d,.]+/)?.[0]?.replace(/[,.]/g, '') || '0';
              const category = q('button.DkEaL')?.textContent?.trim() || '';
              const addrEl = q('button[data-item-id="address"] .Io6YTe') || q('[data-item-id="address"]');
              const address = addrEl?.textContent?.trim() || '';

              // Extracción de teléfono mejorada — múltiples estrategias
              let phone = '';
              const phoneBtn = q('button[data-item-id^="phone:tel:"]') || q('a[data-item-id^="phone:tel:"]');
              if (phoneBtn) {
                phone = phoneBtn.dataset?.itemId?.replace('phone:tel:', '') ||
                        phoneBtn.querySelector('.Io6YTe')?.textContent?.trim() || '';
              }
              if (!phone) {
                for (const btn of document.querySelectorAll('button[aria-label], a[aria-label]')) {
                  const lbl = (btn.getAttribute('aria-label') || '').trim();
                  if (/^[+\d()\-\s]{7,20}$/.test(lbl)) { phone = lbl; break; }
                }
              }
              if (!phone) {
                const telLinks = document.querySelectorAll('a[href^="tel:"]');
                if (telLinks.length) phone = telLinks[0].getAttribute('href').replace('tel:', '');
              }
              if (!phone) {
                // Buscar en todo el texto visible del panel
                const bodyText = document.body.innerText;
                const phoneMatch = bodyText.match(/(?:\+57|57|0)?[\s-]?3\d{2}[\s-]?\d{3}[\s-]?\d{4}/);
                if (phoneMatch) phone = phoneMatch[0];
              }

              const websiteEl = q('a[data-item-id="authority"]') || q('a[href*="http"][data-item-id*="web"]');
              const website = websiteEl?.href || '';
              let email = '';
              const emailMatch = document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (emailMatch) email = emailMatch[0];

              // Extraer lat/lon de la URL actual
              let lat = null, lon = null;
              const urlMatch = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
              if (urlMatch) { lat = parseFloat(urlMatch[1]); lon = parseFloat(urlMatch[2]); }

              return { name, rating, reviews, category, address, phone, website, email, lat, lon };
            });

            await detailPage.close().catch(() => {});
            if (data?.name) return data;
          } catch (err) {
            try { await detailPage?.close().catch(() => {}); } catch {}
            if (attempt === 0) await delay(1500);
          }
        }
        return null;
      }));

      results.push(...batchResults.filter(Boolean));
      await delay(300);
    }

    return results;

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// FUENTE 2: PÁGINAS AMARILLAS COLOMBIA
// ═══════════════════════════════════════════════════════════════
async function searchPaginasAmarillas(query, location, maxResults) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      userDataDir: path.join(os.tmpdir(), `puppeteer_pa_${uuidv4()}`),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: { width: 1280, height: 800 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());

    const searchUrl = `https://www.paginasamarillas.com.co/buscar/${encodeURIComponent(query)}?where=${encodeURIComponent(location)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(2000);

    const results = await page.evaluate((max) => {
      const cards = [...document.querySelectorAll('.search-result-item, .listing-item, [class*="result"], [class*="business-card"]')];
      return cards.slice(0, max).map(card => {
        const name = card.querySelector('h2, h3, .title, [class*="name"], [class*="title"]')?.textContent?.trim() || '';
        const phone = card.querySelector('[class*="phone"], [class*="tel"], a[href^="tel:"]')?.textContent?.trim()
          || card.querySelector('a[href^="tel:"]')?.getAttribute('href')?.replace('tel:', '') || '';
        const address = card.querySelector('[class*="address"], [class*="direction"]')?.textContent?.trim() || '';
        const category = card.querySelector('[class*="category"], [class*="type"]')?.textContent?.trim() || '';
        const website = card.querySelector('a[href^="http"]')?.href || '';
        return { name, phone, address, category, website, source: 'paginas_amarillas' };
      }).filter(r => r.name);
    }, maxResults);

    return results;

  } catch (e) {
    console.warn('[PagAmarillas] Error:', e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// FUENTE 3: FACEBOOK BUSINESS PLACES
// ═══════════════════════════════════════════════════════════════
async function searchFacebookBusiness(query, location, maxResults) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      userDataDir: path.join(os.tmpdir(), `puppeteer_fb_${uuidv4()}`),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: { width: 1280, height: 800 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());

    const fbUrl = `https://www.facebook.com/search/places/?q=${encodeURIComponent(query + ' ' + location)}`;
    await page.goto(fbUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(3000);

    // Cerrar diálogo de login/cookies si aparece
    try {
      const closeBtn = await page.$('[aria-label="Close"], [data-testid="cookie-policy-manage-dialog"] button:last-child, [role="dialog"] button');
      if (closeBtn) { await closeBtn.click(); await delay(1000); }
    } catch {}

    // Scroll para cargar más resultados
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await delay(1500);
    }

    const results = await page.evaluate((max) => {
      const items = [...document.querySelectorAll('[data-testid="results-item"], [role="article"], [class*="search-result"]')];
      return items.slice(0, max).map(item => {
        const name = item.querySelector('h2, h3, strong, [class*="title"]')?.textContent?.trim() || '';
        const address = item.querySelector('[class*="address"], [class*="location"]')?.textContent?.trim() || '';
        const category = item.querySelector('[class*="category"], [class*="type"]')?.textContent?.trim() || '';
        const link = item.querySelector('a[href*="facebook.com"]')?.href || '';
        return { name, address, category, website: link, source: 'facebook' };
      }).filter(r => r.name && r.name.length > 2);
    }, maxResults);

    return results;

  } catch (e) {
    console.warn('[Facebook] Error:', e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// FUENTE 4: INSTAGRAM BUSINESS
// ═══════════════════════════════════════════════════════════════
async function searchInstagramBusiness(query, location, maxResults) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      userDataDir: path.join(os.tmpdir(), `puppeteer_ig_${uuidv4()}`),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: { width: 1280, height: 800 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
    await page.setRequestInterception(true);
    page.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());

    const tag = query.replace(/\s+/g, '').toLowerCase();
    const igUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
    await page.goto(igUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await delay(3000);

    // Cerrar dialog de login si aparece
    try {
      const notNow = await page.$('[role="dialog"] button:last-child');
      if (notNow) { await notNow.click(); await delay(800); }
    } catch {}

    // Recopilar handles de posts visibles
    const handles = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/p/"]')];
      const users = new Set();
      links.forEach(l => {
        const match = l.href.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/p\//);
        if (match?.[1] && !['explore','p','reel','accounts'].includes(match[1])) users.add(match[1]);
      });
      return [...users].slice(0, 15);
    });

    if (!handles.length) return [];

    // Visitar cada perfil para extraer datos de negocio
    const results = [];
    for (const handle of handles.slice(0, maxResults)) {
      let profilePage;
      try {
        profilePage = await browser.newPage();
        await profilePage.setRequestInterception(true);
        profilePage.on('request', req => ['image', 'font', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());
        await profilePage.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15');
        await profilePage.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await delay(1500);

        const profileData = await profilePage.evaluate((h) => {
          const bio = document.querySelector('[data-testid="user-description"], ._aa_c, section > div > div')?.textContent || '';
          const name = document.querySelector('h1, ._aacl._aaco._aacu._aacx._aad7._aade')?.textContent?.trim() || h;
          const category = document.querySelector('[class*="category"]')?.textContent?.trim() || '';
          // Buscar teléfono en bio
          const phoneMatch = bio.match(/(\+?\d[\d\s\-().]{6,18}\d)/);
          const phone = phoneMatch?.[0] || '';
          // Buscar website
          const websiteEl = document.querySelector('a[href*="http"][target="_blank"]');
          const website = websiteEl?.href || '';
          // Email en bio
          const emailMatch = bio.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const email = emailMatch?.[0] || '';
          return { name, phone, email, website, category, bio, instagram: '@' + h, source: 'instagram' };
        }, handle);

        if (profileData.name) results.push(profileData);
        await profilePage.close().catch(() => {});
      } catch {
        try { await profilePage?.close().catch(() => {}); } catch {}
      }
    }

    return results;

  } catch (e) {
    console.warn('[Instagram] Error:', e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// FUENTE 5: OVERPASS API (fallback OSM)
// ═══════════════════════════════════════════════════════════════
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];

async function executeOverpassQuery(q) {
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await http.post(ep, `data=${encodeURIComponent(q)}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
      if (r.data?.elements) return r.data.elements;
    } catch {}
  }
  return [];
}

async function getNominatimBbox(location) {
  try {
    const r = await http.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`, { headers: { 'User-Agent': 'ProspectorAI/2.0' } });
    const d = r.data?.[0];
    if (!d) return null;
    const [south, north, west, east] = d.boundingbox.map(Number);
    const latD = Math.max(north - south, 0.15), lonD = Math.max(east - west, 0.15);
    const clat = (south + north) / 2, clon = (west + east) / 2;
    return { south: clat - latD / 2, north: clat + latD / 2, west: clon - lonD / 2, east: clon + lonD / 2 };
  } catch { return null; }
}

async function searchOverpass(query, location, maxResults) {
  const bbox = await getNominatimBbox(location);
  if (!bbox) return [];
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  const tags = queryToOsmTags(query);
  const filters = tags.some(t => !t.v)
    ? `["name"~"${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",i]`
    : tags.map(({ k, v }) => v ? `["${k}"="${v}"]` : `["${k}"]`).join('');
  const oq = `[out:json][timeout:15];(node${filters}(${bboxStr});way${filters}(${bboxStr}););out body center ${Math.max(500, maxResults * 15)};`;
  const els = await executeOverpassQuery(oq);
  return els.map(el => osmToProspect(el, query)).filter(Boolean);
}

function osmToProspect(el, query) {
  const tags = el.tags || {};
  const name = tags.name || tags['name:es'] || tags.brand || '';
  if (!name || name.length < 2) return null;
  return {
    name,
    phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || tags['contact:whatsapp'] || '',
    website: tags.website || tags['contact:website'] || '',
    instagram: tags['contact:instagram'] || tags.instagram || '',
    email: tags.email || tags['contact:email'] || '',
    address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(', '),
    category: tags.amenity || tags.shop || tags.leisure || tags.office || '',
    niche: osmCategoryToNiche(tags),
    source: 'openstreetmap',
    lat: el.lat || el.center?.lat,
    lon: el.lon || el.center?.lon
  };
}

function osmCategoryToNiche(tags) {
  const cat = (tags.amenity || tags.shop || tags.leisure || tags.office || '').toLowerCase();
  const m = { restaurant: 'Restauración', fast_food: 'Restauración', cafe: 'Restauración', bar: 'Restauración', bakery: 'Restauración', hairdresser: 'Belleza & Bienestar', beauty: 'Belleza & Bienestar', nail_salon: 'Belleza & Bienestar', fitness_centre: 'Fitness', gym: 'Fitness', dentist: 'Salud', clinic: 'Salud', hospital: 'Salud', pharmacy: 'Salud', hotel: 'Hospedaje', clothes: 'Retail', estate_agent: 'Inmobiliaria', lawyer: 'Legal', school: 'Educación' };
  return m[cat] || 'Negocio Local';
}

function queryToOsmTags(query) {
  const map = [
    { test: /restaurante|restaurant|comida|food/i, tags: [{ k: 'amenity', v: 'restaurant' }] },
    { test: /caf[eé]|coffee/i, tags: [{ k: 'amenity', v: 'cafe' }] },
    { test: /pizza/i, tags: [{ k: 'amenity', v: 'fast_food' }] },
    { test: /panadería|bakery/i, tags: [{ k: 'shop', v: 'bakery' }] },
    { test: /sal[oó]n|belleza|barbería|peluquer|nail/i, tags: [{ k: 'shop', v: 'hairdresser' }] },
    { test: /dental|dentista/i, tags: [{ k: 'amenity', v: 'dentist' }] },
    { test: /cl[ií]nica|médico|doctor/i, tags: [{ k: 'amenity', v: 'clinic' }] },
    { test: /farmacia/i, tags: [{ k: 'amenity', v: 'pharmacy' }] },
    { test: /gym|gimnasio|fitness|yoga/i, tags: [{ k: 'leisure', v: 'fitness_centre' }] },
    { test: /hotel/i, tags: [{ k: 'tourism', v: 'hotel' }] },
    { test: /abogado|law|legal/i, tags: [{ k: 'office', v: 'lawyer' }] },
    { test: /inmobil|real estate/i, tags: [{ k: 'office', v: 'estate_agent' }] },
  ];
  for (const { test, tags } of map) if (test.test(query)) return tags;
  return [{ k: 'name', v: null }];
}

// ═══════════════════════════════════════════════════════════════
// ENRIQUECIMIENTO
// ═══════════════════════════════════════════════════════════════
async function enrichProspect(raw, location = '') {
  if (!raw?.name) return null;

  const ccMap = { colombia: '57', mexico: '52', venezuela: '58', argentina: '54', peru: '51', chile: '56', españa: '34', 'estados unidos': '1', panama: '507', ecuador: '593', costa: '506', bolivia: '591' };
  const cc = Object.entries(ccMap).find(([k]) => location.toLowerCase().includes(k))?.[1] || '57';

  const finalPhone = normalizePhoneEnrich(raw.phone || '', cc);

  const prospect = {
    id:         uuidv4(),
    name:       raw.name,
    phone:      finalPhone,
    email:      raw.email || '',
    website:    raw.website || '',
    hasWebsite: !!(raw.website && raw.website.length > 4),
    address:    raw.address || '',
    rating:     raw.rating ? parseFloat(raw.rating) : null,
    reviews:    raw.reviews || '0',
    niche:      raw.niche || raw.category || determineNicheFromName(raw.name),
    instagram:  raw.instagram || '',
    score:      calculateScore(raw),
    status:     'new',
    stage:      'new',
    notes:      '',
    source:     raw.source || 'google_maps',
    lat:        raw.lat != null ? parseFloat(raw.lat) : null,
    lon:        raw.lon != null ? parseFloat(raw.lon) : null,
  };

  // Enriquecer email/instagram desde website
  if (prospect.website && (!prospect.instagram || !prospect.email)) {
    try {
      const enriched = await scrapeWebsiteContact(prospect.website);
      if (!prospect.instagram && enriched.instagram) prospect.instagram = enriched.instagram;
      if (!prospect.email && enriched.email) prospect.email = enriched.email;
    } catch {}
  }

  // Determinar nicho si falta
  if (!prospect.niche || prospect.niche === 'Negocio Local') {
    prospect.niche = determineNicheFromName(prospect.name);
  }

  return prospect;
}

async function scrapeWebsiteContact(website) {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const resp = await http.get(url, { timeout: 6000, maxContentLength: 200 * 1024, headers: { Accept: 'text/html' } });
    const $ = cheerio.load(resp.data);
    let ig = '';
    $('a[href*="instagram.com"]').each((_, el) => {
      if (ig) return false;
      const m = ($(el).attr('href') || '').match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
      if (m?.[1] && !['explore', 'p', 'reel', 'stories', 'accounts'].includes(m[1])) ig = '@' + m[1];
    });
    const emailMatch = resp.data.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch?.[0] && !emailMatch[0].includes('example') && !emailMatch[0].includes('sentry') ? emailMatch[0] : '';
    return { instagram: ig, email };
  } catch { return { instagram: '', email: '' }; }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function normalizePhoneEnrich(phone, defaultCC = '57') {
  if (!phone) return '';
  const first = String(phone).trim().split(/[,;]/)[0].trim();
  const digits = first.replace(/\D/g, '');
  if (!digits || digits.length < 6) return '';
  if (first.startsWith('+') && digits.length >= 10) return digits;
  if (first.startsWith('00') && digits.length >= 10) return digits.slice(2);
  if (digits.length === 10) return `${defaultCC}${digits}`;
  if (digits.length > 10) return digits;
  return digits.length >= 7 ? `${defaultCC}${digits}` : '';
}

function determineNicheFromName(name = '') {
  const n = name.toLowerCase();
  if (/restaurante|comida|pizza|sushi|burger|café|panadería|grill|asadero|bbq/i.test(n)) return 'Restauración';
  if (/salon|beauty|spa|nails|barber|estética|peluquer|nail/i.test(n)) return 'Belleza & Bienestar';
  if (/gym|fitness|yoga|pilates|crossfit/i.test(n)) return 'Fitness';
  if (/dental|dent|odonto|clínica|médico|salud|optic|psico/i.test(n)) return 'Salud';
  if (/inmobil|propiedad|finca|apartamento|real estate/i.test(n)) return 'Inmobiliaria';
  if (/tienda|store|shop|boutique|moda|ropa/i.test(n)) return 'Retail';
  if (/hotel|hostal|airbnb|hospedaje/i.test(n)) return 'Hospedaje';
  if (/abogad|legal|juridic|bufete/i.test(n)) return 'Legal';
  if (/tech|software|digital|web|app|sistemas/i.test(n)) return 'Tecnología';
  if (/academia|escuela|colegio|cursos|clases/i.test(n)) return 'Educación';
  return 'Negocio Local';
}

function calculateScore(raw) {
  let s = 50;
  if (raw.phone) s += 25;
  if (raw.email) s += 10;
  if (!raw.website) s += 15; else s -= 5;
  if (!raw.instagram) s += 5;
  const r = parseFloat(raw.rating) || 0;
  if (r >= 4.5) s += 10; else if (r >= 4.0) s += 5; else if (r > 0 && r < 3) s -= 10;
  if (parseInt(raw.reviews) > 200) s += 5; else if (parseInt(raw.reviews) > 50) s += 2;
  return Math.min(100, Math.max(0, s));
}

function mergeSources(a, b) {
  const names = new Set(a.map(x => (x.name || '').toLowerCase().trim()));
  const phones = new Set(a.map(x => x.phone).filter(Boolean));
  return [...a, ...b.filter(x => {
    const n = (x.name || '').toLowerCase().trim();
    if (names.has(n)) return false;
    if (x.phone && phones.has(x.phone)) return false;
    names.add(n);
    if (x.phone) phones.add(x.phone);
    return true;
  })];
}

async function runConcurrent(arr, fn, limit = 4) {
  const res = [];
  for (let i = 0; i < arr.length; i += limit) {
    res.push(...await Promise.all(arr.slice(i, i + limit).map(fn)));
  }
  return res;
}

module.exports = { search, clearCache: () => CACHE.clear() };
