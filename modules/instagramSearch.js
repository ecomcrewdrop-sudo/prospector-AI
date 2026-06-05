/**
 * INSTAGRAM SEARCH MODULE — Google Dorking via Puppeteer
 * ─────────────────────────────────────────────────
 * Busca perfiles de Instagram extrayendo datos directamente 
 * de los resultados de Google para evitar bloqueos de IG.
 */

const puppeteer = require('puppeteer');
const axios = require('axios');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function resolvePhoneFromLink(link) {
  if (!link) return '';
  try {
    const url = link.startsWith('http') ? link : `https://${link}`;
    // Fast redirect check for wa.link or bit.ly
    const resp = await axios.get(url, { 
      timeout: 5000, 
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    // Check final URL for phone
    const finalUrl = resp.request?.res?.responseUrl || url;
    const urlMatch = finalUrl.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?([+\d]+)/i);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    // Check HTML content for wa.me links
    const html = resp.data;
    if (typeof html === 'string') {
      const htmlMatch = html.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?([+\d]+)/i);
      if (htmlMatch && htmlMatch[1]) return htmlMatch[1];
    }
  } catch (err) {
    // Axios might throw on redirect or 404, we can check err.request.res.responseUrl if available
    const errorUrl = err.request?.res?.responseUrl;
    if (errorUrl) {
      const urlMatch = errorUrl.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?([+\d]+)/i);
      if (urlMatch && urlMatch[1]) return urlMatch[1];
    }
  }
  return '';
}

async function searchInstagram(query, location, maxResults = 20, onProgress) {
  let browser;
  const results = [];
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1366,768', '--disable-extensions'
      ],
      defaultViewport: { width: 1366, height: 768 }
    });

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Bloquear recursos pesados
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });

    // Construir Google Dork para Instagram
    // Ejemplo: site:instagram.com "odontologo" "medellin" ("wa.me" OR "whatsapp" OR "+57")
    // Identificamos posible código de país por ubicación (simplificado)
    const ccMap = { colombia:'57', mexico:'52', venezuela:'58', argentina:'54', peru:'51', chile:'56', españa:'34', 'estados unidos':'1', panama:'507', ecuador:'593' };
    const cc = Object.entries(ccMap).find(([k]) => location.toLowerCase().includes(k))?.[1] || '57';
    
    const dorkQuery = `site:instagram.com ${query} ${location} (whatsapp OR wa.me OR wa.link OR +${cc}) -site:instagram.com/p/ -site:instagram.com/reel/`;
    
    let bOffset = 1;
    let pageCount = 0;
    const maxPages = 4; // Fetch up to 4 pages of Yahoo
    const seenLinks = new Set();

    while (results.length < maxResults && pageCount < maxPages) {
      const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(dorkQuery)}&n=50&b=${bOffset}`;
      if (onProgress) onProgress({ pct: 15 + (pageCount * 10), text: `📸 Buscando en IG (Página ${pageCount + 1})...` });

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Extraer resultados de búsqueda de Yahoo
      const snippets = await page.evaluate(() => {
        const els = [...document.querySelectorAll('div.algo, div.algo-sr')];
        return els.map(el => {
          const a = el.querySelector('a'); // el enlace a instagram
          const title = a?.textContent || el.querySelector('h3')?.textContent || '';
          const snippet = el.querySelector('.compText')?.textContent || el.innerText || '';
          const link = a?.href || '';
          return { link, title, snippet };
        });
      });

      if (snippets.length === 0) break; // Fin de los resultados

      // Filtrar y limpiar resultados
      for (const item of snippets) {
        if (!item.link.includes('instagram.com') || seenLinks.has(item.link)) continue;
        seenLinks.add(item.link);
        
        // Filter out generic paths completely
        if (item.link.match(/\/(p|reel|reels|explore|stories|popular|directory|channel|tags|about)\//i)) continue;
        if (item.title.toLowerCase().includes('reel') || item.title.toLowerCase().includes('post')) continue;
        
        // Extraer arroba del título o URL
        const usernameMatch = item.title.match(/\(@([a-zA-Z0-9_.-]+)\)/) || item.link.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/);
        let rawUser = usernameMatch ? usernameMatch[1] : '';
        rawUser = rawUser.replace(/[^a-zA-Z0-9_.-]/g, ''); // Clean trailing slashes or weird chars
        
        const ignoredPaths = ['p','reel','reels','explore','tags','stories','popular','directory','channel','about','help'];
        if (!rawUser || ignoredPaths.includes(rawUser.toLowerCase())) continue;

        const username = `@${rawUser}`;
        
        // Extraer nombre comercial, limpiando artefactos de Yahoo
        let name = item.title.replace(/Instagram.*?https.*/ig, '').split(/(\(|•|-)/)[0].trim();
        if (!name || name.toLowerCase() === 'instagram') name = username;

        // Buscar teléfono en el snippet
        let phone = '';
        const waMatch = item.snippet.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/channel\/|wa\.link)\/?([+\d]+)?/i);
        if (waMatch && waMatch[1] && waMatch[1].match(/\d/)) {
          phone = waMatch[1];
        } else {
          const phoneMatch = item.snippet.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
          if (phoneMatch) phone = phoneMatch[0];
        }

        // Buscar linktrees y webs
        let website = '';
        const linkMatch = item.snippet.match(/(linktr\.ee|beacons\.ai|lnk\.bio|bit\.ly|campsite\.bio|taplink\.cc|wa\.link)\/[a-zA-Z0-9_-]+/i);
        if (linkMatch) {
          website = `https://${linkMatch[0]}`;
        } else {
          const urlMatch = item.snippet.match(/(https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/);
          if (urlMatch && !urlMatch[1].includes('instagram.com')) {
            website = urlMatch[1];
          }
        }

        // ── ROBUST PHONE EXTRACTION ──────────────────────────────
        if (!phone && website && (website.includes('linktr.ee') || website.includes('wa.link') || website.includes('bit.ly') || website.includes('beacons.ai') || website.includes('lnk.bio'))) {
          try {
            phone = await resolvePhoneFromLink(website);
          } catch (e) {}
        }

        results.push({
          name: name || query,
          phone: phone || '', 
          instagram: username || item.link,
          website: website,
          address: location,
          source: 'instagram_dork',
          rating: null,
          reviews: '0',
          category: query
        });

        if (results.length >= maxResults) break;
      }
      
      bOffset += 50;
      pageCount++;
    }

    return results;

  } catch (err) {
    console.error('[IG Search Error]', err);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { searchInstagram };
