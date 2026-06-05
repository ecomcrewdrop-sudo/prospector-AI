/**
 * SEARCH MODULE — Google Maps Primary (Puppeteer)
 * ─────────────────────────────────────────────────
 * Fuentes en cascada:
 *   1. Google Maps (Puppeteer scraping) — datos REALES y completos
 *   2. Overpass API (OpenStreetMap)     — fallback sin navegador
 *   3. Demo enriquecido                 — último recurso
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');

// ── Caché simple ────────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function cacheGet(k) { const e = CACHE.get(k); if (!e) return null; if (Date.now()-e.ts > CACHE_TTL) { CACHE.delete(k); return null; } return e.data; }
function cacheSet(k, d) { CACHE.set(k, { data: d, ts: Date.now() }); }

const delay = ms => new Promise(r => setTimeout(r, ms));

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'es-ES,es;q=0.9' }
});

async function mapConcurrent(arr, fn, limit = 3) {
  const res = [];
  for (let i = 0; i < arr.length; i += limit) {
    res.push(...await Promise.all(arr.slice(i, i+limit).map(fn)));
  }
  return res;
}

// ════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ════════════════════════════════════════════════════════════
async function search({ query, location, maxResults = 20, onProgress }) {
  const cacheKey = `${query}|${location}|${maxResults}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    if (onProgress) onProgress({ pct: 100, text: 'Resultado desde caché ⚡' });
    return cached;
  }

  let raw = [];

  // Buffer interno: pedir 60% más para compensar páginas de detalle que fallen
  const fetchTarget = Math.min(Math.ceil(maxResults * 1.6), 80);

  // ── FUENTE 1: Google Maps — búsqueda principal ──────────────
  if (onProgress) onProgress({ pct: 10, text: '🗺️ Buscando en Google Maps...' });
  try {
    raw = await searchGoogleMaps(query, location, fetchTarget, onProgress);
    console.log(`[GMaps 1ª] ${raw.length}/${fetchTarget} resultados`);
  } catch (e) {
    console.warn('[GMaps 1ª] Error:', e.message);
  }

  // ── FUENTE 1b: Google Maps — segunda pasada con query variado ──
  if (raw.length < maxResults) {
    const needed = Math.min(fetchTarget - raw.length + 10, 40);
    const altQuery = `${query} en ${location}`;
    if (onProgress) onProgress({ pct: 40, text: `🗺️ Segunda búsqueda Maps (${raw.length}/${maxResults} encontrados)...` });
    try {
      const pass2 = await searchGoogleMaps(altQuery, location, needed, null);
      const before = raw.length;
      raw = mergeSources(raw, pass2);
      console.log(`[GMaps 2ª] +${raw.length - before} nuevos. Total: ${raw.length}`);
    } catch (e) {
      console.warn('[GMaps 2ª] Error:', e.message);
    }
  }

  // ── FUENTE 2: OpenStreetMap — complementa con datos reales OSM ──
  if (raw.length < maxResults) {
    const needed = maxResults - raw.length + 10;
    if (onProgress) onProgress({ pct: 55, text: `🌍 Complementando desde OpenStreetMap (${raw.length}/${maxResults})...` });
    try {
      const osm = await searchOverpass(query, location, needed);
      raw = mergeSources(raw, osm);
      console.log(`[OSM] +${osm.length} resultados. Total: ${raw.length}`);
    } catch (e) {
      console.warn('[OSM] Error:', e.message);
    }
  }

  // Sin relleno demo — solo negocios reales
  if (raw.length < maxResults) {
    console.log(`[Search] ${raw.length}/${maxResults} negocios reales disponibles en esta zona`);
    if (onProgress) onProgress({ pct: 73, text: `ℹ️ ${raw.length} negocios reales encontrados en esta zona` });
  }

  // ── Enriquecer los resultados reales disponibles ────────────────
  const toEnrich = raw.slice(0, maxResults);
  if (onProgress) onProgress({ pct: 75, text: `✨ Enriqueciendo ${toEnrich.length} negocios reales...` });
  let done = 0;
  const enriched = await mapConcurrent(toEnrich, async r => {
    const p = await enrichProspect(r, location);
    done++;
    if (onProgress) onProgress({ pct: 75 + Math.round((done / toEnrich.length) * 20), text: `Procesando: ${r.name || '...'}` });
    return p;
  }, 3);

  const final = enriched.filter(Boolean);
  cacheSet(cacheKey, final);
  if (onProgress) onProgress({ pct: 100, text: `✅ ${final.length} prospectos reales encontrados` });
  return final;
}

// ════════════════════════════════════════════════════════════
// FUENTE 1: GOOGLE MAPS SCRAPER (Puppeteer)
// ════════════════════════════════════════════════════════════
async function searchGoogleMaps(query, location, maxResults, onProgress) {
  const puppeteer = require('puppeteer');
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1366,768', '--disable-extensions',
        '--disable-background-timer-throttling'
      ],
      defaultViewport: { width: 1366, height: 768 }
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Ignorar recursos innecesarios para ir más rápido
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query + ' ' + location)}?hl=es&gl=co`;
    if (onProgress) onProgress({ pct: 15, text: `🔍 Buscando "${query}" en Google Maps...` });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Aceptar cookies si aparece el diálogo
    try {
      await page.waitForSelector('button[aria-label*="cept"], form button', { timeout: 4000 });
      const btns = await page.$$('form button');
      if (btns.length) await btns[btns.length - 1].click();
      await delay(1000);
    } catch {}

    // Esperar feed de resultados
    try {
      await page.waitForSelector('[role="feed"]', { timeout: 15000 });
    } catch {
      console.warn('[GMaps] No apareció el feed de resultados');
      return [];
    }

    if (onProgress) onProgress({ pct: 25, text: `📋 Cargando lista de resultados...` });

    // Scroll para cargar la cantidad solicitada
    let previousCount = 0;
    let stuckRetries = 0;
    for (let i = 0; i < 60; i++) {  // 60 iteraciones para cargar más resultados
      const count = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) {
          feed.scrollBy(0, 8000);   // scroll más agresivo
          feed.scrollTop = feed.scrollHeight;
        }
        return document.querySelectorAll('[role="feed"] a.hfpxzc').length;
      });
      
      if (count >= maxResults) break;
      
      if (count === previousCount) {
        stuckRetries++;
        if (stuckRetries >= 8) break; // 8 intentos antes de asumir que no hay más
      } else {
        stuckRetries = 0;
      }
      previousCount = count;
      await delay(1200); // Tiempo reducido para ser más rápido
    }

    // Extraer links de cada resultado
    const placeLinks = await page.evaluate((max) => {
      const cards = [...document.querySelectorAll('[role="feed"] a.hfpxzc')];
      return cards.slice(0, max).map(a => ({
        href: a.href,
        name: a.getAttribute('aria-label') || ''
      }));
    }, maxResults);

    if (!placeLinks.length) return [];
    if (onProgress) onProgress({ pct: 30, text: `📍 ${placeLinks.length} negocios encontrados. Extrayendo datos...` });

    // Visitar cada lugar para extraer datos completos
    const results = [];
    for (let i = 0; i < placeLinks.length; i++) {
      const link = placeLinks[i];
      if (onProgress) onProgress({
        pct: 30 + Math.round((i / placeLinks.length) * 40),
        text: `📊 Extrayendo datos ${i+1}/${placeLinks.length}: ${link.name}`
      });

      // Extraer datos con reintento automático (1 retry si falla)
      let data = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        let detailPage = null;
        try {
          detailPage = await browser.newPage();
          await detailPage.setRequestInterception(true);
          detailPage.on('request', req => {
            if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
          });
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

          await detailPage.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await delay(attempt === 0 ? 1800 : 2800); // más espera en el retry

          const extracted = await detailPage.evaluate(() => {
            const q  = sel => document.querySelector(sel);

            const name = q('h1.DUwDvf')?.textContent?.trim()
              || q('h1')?.textContent?.trim() || '';

            const ratingEl = q('div.F7nice span[aria-hidden="true"]') || q('span.ceNzKf[aria-label]');
            const rating = ratingEl?.textContent?.trim() || null;

            const reviewsEl = q('div.F7nice span[aria-label]') || q('button[jsaction*="pane.rating"]');
            const reviewsText = reviewsEl?.getAttribute('aria-label') || reviewsEl?.textContent || '';
            const reviews = reviewsText.match(/[\d,.]+/)?.[0]?.replace(/[,.]/g, '') || '0';

            const category = q('button.DkEaL')?.textContent?.trim()
              || q('[jsaction*="category"] span')?.textContent?.trim() || '';

            const addrEl = q('button[data-item-id="address"] .Io6YTe') || q('[data-item-id="address"]');
            const address = addrEl?.textContent?.trim() || '';

            let phone = '';
            const phoneBtn = q('button[data-item-id^="phone:tel:"]') || q('a[data-item-id^="phone:tel:"]');
            if (phoneBtn) {
              phone = phoneBtn.dataset.itemId?.replace('phone:tel:', '') || '';
              if (!phone) phone = phoneBtn.querySelector('.Io6YTe')?.textContent?.trim() || '';
            }
            if (!phone) {
              const allBtns = [...document.querySelectorAll('button[aria-label], a[aria-label]')];
              for (const btn of allBtns) {
                const lbl = btn.getAttribute('aria-label') || '';
                if (/^[+\d()\-\s]{7,20}$/.test(lbl.trim())) { phone = lbl.trim(); break; }
              }
            }

            const websiteEl = q('a[data-item-id="authority"]') || q('a[href*="http"][data-item-id*="web"]');
            const website = websiteEl?.href || '';

            return { name, rating, reviews, category, address, phone, website };
          });

          await detailPage.close().catch(() => {});

          if (extracted?.name) { data = extracted; break; } // éxito

        } catch (err) {
          try { if (detailPage) await detailPage.close().catch(() => {}); } catch {}
          if (attempt === 0) {
            console.warn(`[GMaps] Reintentando "${link.name}"...`);
            await delay(2000);
          } else {
            console.warn(`[GMaps] Fallo definitivo "${link.name}": ${err.message}`);
          }
        }
      } // fin retry

      if (data) results.push(data);

      await delay(400);
    }

    return results;

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════
// FUENTE 2: OVERPASS API (OpenStreetMap)
// ════════════════════════════════════════════════════════════
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
];

async function executeOverpassQuery(q) {
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await http.post(ep, `data=${encodeURIComponent(q)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
      if (r.data?.elements) return r.data.elements;
    } catch {}
  }
  return [];
}

async function getNominatimBbox(location) {
  try {
    const r = await http.get(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'ProspectorAI/1.0' } }
    );
    const d = r.data?.[0];
    if (!d) return null;
    const [south, north, west, east] = d.boundingbox.map(Number);
    const latD = Math.max(north-south, 0.15), lonD = Math.max(east-west, 0.15);
    const clat = (south+north)/2, clon = (west+east)/2;
    return { south: clat-latD/2, north: clat+latD/2, west: clon-lonD/2, east: clon+lonD/2 };
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
  const limit = Math.max(500, maxResults * 15);
  const oq = `[out:json][timeout:15];(node${filters}(${bboxStr});way${filters}(${bboxStr}););out body center ${limit};`;
  const els = await executeOverpassQuery(oq);
  return els.map(el => osmElementToProspect(el, query)).filter(Boolean);
}

function osmElementToProspect(el, query) {
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
    rating: null, reviews: null,
    category: tags.amenity || tags.shop || tags.leisure || tags.office || '',
    niche: osmCategoryToNiche(tags),
    source: 'openstreetmap',
    lat: el.lat || el.center?.lat,
    lon: el.lon || el.center?.lon
  };
}

function osmCategoryToNiche(tags) {
  const cat = (tags.amenity || tags.shop || tags.leisure || tags.office || '').toLowerCase();
  const m = { restaurant:'Restauración',fast_food:'Restauración',cafe:'Restauración',bar:'Restauración',bakery:'Restauración',hairdresser:'Belleza & Bienestar',beauty:'Belleza & Bienestar',nail_salon:'Belleza & Bienestar',fitness_centre:'Fitness',gym:'Fitness',dentist:'Salud',clinic:'Salud',hospital:'Salud',pharmacy:'Salud',optician:'Salud',hotel:'Hospedaje',hostel:'Hospedaje',clothes:'Retail',shoes:'Retail',real_estate:'Inmobiliaria',estate_agent:'Inmobiliaria',lawyer:'Legal',notary:'Legal',school:'Educación',college:'Educación' };
  return m[cat] || 'Negocio Local';
}

function queryToOsmTags(query) {
  const map = [
    { test: /restaurante|restaurant|comida|food/i, tags: [{ k:'amenity', v:'restaurant' }] },
    { test: /caf[eé]|coffee/i, tags: [{ k:'amenity', v:'cafe' }] },
    { test: /pizza/i, tags: [{ k:'amenity', v:'fast_food' }] },
    { test: /panadería|bakery/i, tags: [{ k:'shop', v:'bakery' }] },
    { test: /bar\b/i, tags: [{ k:'amenity', v:'bar' }] },
    { test: /sal[oó]n|belleza|barbería|peluquer|nail|uñas/i, tags: [{ k:'shop', v:'hairdresser' }] },
    { test: /dental|dentista/i, tags: [{ k:'amenity', v:'dentist' }] },
    { test: /cl[ií]nica|médico|doctor/i, tags: [{ k:'amenity', v:'clinic' }] },
    { test: /farmacia/i, tags: [{ k:'amenity', v:'pharmacy' }] },
    { test: /hospital/i, tags: [{ k:'amenity', v:'hospital' }] },
    { test: /gym|gimnasio|fitness|yoga/i, tags: [{ k:'leisure', v:'fitness_centre' }] },
    { test: /hotel/i, tags: [{ k:'tourism', v:'hotel' }] },
    { test: /abogado|law|legal/i, tags: [{ k:'office', v:'lawyer' }] },
    { test: /inmobil|real estate/i, tags: [{ k:'office', v:'estate_agent' }] },
    { test: /colegio|escuela/i, tags: [{ k:'amenity', v:'school' }] },
  ];
  for (const { test, tags } of map) if (test.test(query)) return tags;
  return [{ k:'name', v:null }];
}

// ════════════════════════════════════════════════════════════
// ENRIQUECIMIENTO
// ════════════════════════════════════════════════════════════
async function enrichProspect(raw, location = '') {
  if (!raw?.name) return null;

  const ccMap = { colombia:'57', mexico:'52', venezuela:'58', argentina:'54', peru:'51', chile:'56', españa:'34', 'estados unidos':'1', panama:'507', ecuador:'593' };
  const cc = Object.entries(ccMap).find(([k]) => location.toLowerCase().includes(k))?.[1] || '57';

  const finalPhone = normalizePhone(raw.phone || '', cc);

  const prospect = {
    id:         uuidv4(),
    name:       raw.name,
    phone:      finalPhone,
    whatsapp:   finalPhone,
    website:    raw.website  || '',
    hasWebsite: !!(raw.website && raw.website.length > 4),
    address:    raw.address  || '',
    rating:     raw.rating   ? parseFloat(raw.rating) : null,
    reviews:    raw.reviews  || '0',
    niche:      raw.niche || raw.category || determineNicheFromName(raw.name),
    instagram:  raw.instagram || '',
    email:      raw.email    || '',
    score:      calculateScore(raw),
    status:     'new',
    notes:      '',
    source:     raw.source   || 'google_maps',
    lat:        raw.lat      || null,
    lon:        raw.lon      || null,
    scrapedAt:  new Date().toISOString()
  };

  // Buscar Instagram en el sitio web si no tenemos
  if (prospect.website && !prospect.instagram) {
    try { prospect.instagram = await findInstagramFast(prospect.website); } catch {}
  }

  if (!prospect.niche || prospect.niche === 'Negocio Local') {
    prospect.niche = determineNicheFromName(prospect.name);
  }

  return prospect;
}

async function findInstagramFast(website) {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const resp = await http.get(url, { timeout: 5000, maxContentLength: 150*1024, headers: { Accept: 'text/html' } });
    const $ = cheerio.load(resp.data);
    let ig = '';
    $('a[href*="instagram.com"]').each((_, el) => {
      if (ig) return false;
      const m = ($(el).attr('href')||'').match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
      if (m?.[1] && !['explore','p','reel','stories','accounts'].includes(m[1])) ig = '@'+m[1];
    });
    return ig;
  } catch { return ''; }
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function normalizePhone(phone, defaultCC = '57') {
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
  if (/restaurante|comida|pizza|sushi|burger|café|panadería|grill|asadero/i.test(n)) return 'Restauración';
  if (/salon|beauty|spa|nails|barber|estética|peluquer/i.test(n)) return 'Belleza & Bienestar';
  if (/gym|fitness|yoga|pilates|crossfit/i.test(n)) return 'Fitness';
  if (/dental|dent|odonto|clínica|médico|salud|optic/i.test(n)) return 'Salud';
  if (/inmobil|propiedad|finca|apartamento|real estate/i.test(n)) return 'Inmobiliaria';
  if (/tienda|store|shop|boutique|moda/i.test(n)) return 'Retail';
  if (/hotel|hostal|airbnb|hospedaje/i.test(n)) return 'Hospedaje';
  if (/abogad|legal|juridic|bufete/i.test(n)) return 'Legal';
  if (/tech|software|digital|web|app|sistemas/i.test(n)) return 'Tecnología';
  if (/academia|escuela|colegio|cursos|clases/i.test(n)) return 'Educación';
  return 'Negocio Local';
}

function calculateScore(raw) {
  let s = 50;
  if (raw.phone) s += 25;
  if (!raw.website) s += 20; else s -= 5;
  if (!raw.instagram) s += 5;
  const r = parseFloat(raw.rating) || 0;
  if (r >= 4.5) s += 10; else if (r >= 4.0) s += 5; else if (r > 0 && r < 3) s -= 10;
  if (parseInt(raw.reviews) > 200) s += 5; else if (parseInt(raw.reviews) > 50) s += 2;
  return Math.min(100, Math.max(0, s));
}

function mergeSources(a, b) {
  const names = new Set(a.map(x => (x.name||'').toLowerCase()));
  return [...a, ...b.filter(x => !names.has((x.name||'').toLowerCase()))];
}

// ════════════════════════════════════════════════════════════
// DEMO ENRIQUECIDO (último recurso)
// ════════════════════════════════════════════════════════════
function generateDemoProspects(query, location, count) {
  const niche = determineNicheFromName(query);
  const city  = location.split(',')[0].trim();
  const ccMap = { colombia:'57', mexico:'52', venezuela:'58', argentina:'54', peru:'51', chile:'56', españa:'34' };
  const cc = Object.entries(ccMap).find(([k]) => location.toLowerCase().includes(k))?.[1] || '57';
  const bases = ['El Central','Los Andes','La Mejor','Express','Premium','San Juan','Elite','del Norte','La Familia','Nuevo','Plus','Gold','La Esquina','VIP','La Casa','Integral'];
  return Array.from({ length: count }, (_, i) => {
    const base = bases[i % bases.length];
    const nm = `${query.charAt(0).toUpperCase()+query.slice(1)} ${base}${i >= bases.length ? ' '+(Math.floor(i/bases.length)+1) : ''}`;
    const hasWeb = Math.random() > 0.55, hasIg = Math.random() > 0.3;
    const rnd10 = () => '3' + Math.floor(100000000 + Math.random() * 899999999);
    return {
      name: nm,
      phone: `+${cc}${rnd10()}`,
      website: hasWeb ? `https://www.${nm.toLowerCase().replace(/[^a-z0-9]/g,'')}.com` : '',
      instagram: hasIg ? `@${nm.toLowerCase().replace(/[^a-z0-9]/g,'_')}` : '',
      rating: +(3.8 + Math.random()*1.2).toFixed(1),
      reviews: String(Math.floor(20 + Math.random()*600)),
      niche, category: niche,
      address: `Cra ${Math.floor(1+Math.random()*99)} #${Math.floor(1+Math.random()*99)}-${Math.floor(1+Math.random()*99)}, ${city}`,
      source: 'demo_enriched'
    };
  });
}

module.exports = { search, clearCache: () => CACHE.clear() };
