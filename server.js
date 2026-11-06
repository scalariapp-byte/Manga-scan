// Serveur Manga-scan : sert l'interface et relaie (proxy) l'API publique MangaDex.
// Aucune dépendance : Node >= 18 (fetch natif).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const API = (process.env.MANGADEX_API || 'https://api.mangadex.org').replace(/\/$/, '');
const COVERS = (process.env.MANGADEX_COVERS || 'https://uploads.mangadex.org').replace(/\/$/, '');
const UA = 'Manga-scan/1.0 (lecteur personnel)';
const PUBLIC = path.join(__dirname, 'public');

// Hôtes autorisés pour le proxy d'images (évite que le serveur serve de proxy ouvert).
const IMAGE_HOSTS = [/\.mangadex\.network$/, /^uploads\.mangadex\.org$/, /^api\.mangadex\.org$/];
for (const h of (process.env.EXTRA_IMAGE_HOSTS || '').split(',').filter(Boolean)) {
  IMAGE_HOSTS.push(new RegExp('^' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// Petit cache mémoire pour limiter les appels (MangaDex limite à ~5 req/s).
const cache = new Map();
async function apiGet(pathAndQuery, ttlMs = 5 * 60 * 1000) {
  const hit = cache.get(pathAndQuery);
  if (hit && hit.exp > Date.now()) return hit.data;
  const res = await fetch(API + pathAndQuery, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`MangaDex ${res.status} sur ${pathAndQuery}`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  const data = await res.json();
  cache.set(pathAndQuery, { data, exp: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

const RATINGS = ['safe', 'suggestive'];
const UUID = /^[0-9a-f-]{36}$/i;
const LANG = /^[a-z]{2}(-[a-z]{2})?$/i;

function pickTitle(obj, langs) {
  if (!obj) return '';
  for (const l of langs) if (obj[l]) return obj[l];
  return Object.values(obj)[0] || '';
}

function simplifyManga(m, lang) {
  const a = m.attributes;
  const langs = [lang, 'fr', 'en', 'ja-ro', 'ja'];
  let title = pickTitle(a.title, langs);
  const alt = (a.altTitles || []).find((t) => t[lang]);
  if (alt && !a.title[lang]) title = alt[lang];
  const cover = (m.relationships || []).find((r) => r.type === 'cover_art');
  const author = (m.relationships || []).find((r) => r.type === 'author');
  return {
    id: m.id,
    title,
    description: pickTitle(a.description, [lang, 'fr', 'en']),
    status: a.status,
    year: a.year,
    tags: (a.tags || []).map((t) => pickTitle(t.attributes.name, [lang, 'en'])).slice(0, 8),
    author: author && author.attributes ? author.attributes.name : null,
    cover: cover && cover.attributes ? `/img?u=${encodeURIComponent(`${COVERS}/covers/${m.id}/${cover.attributes.fileName}.256.jpg`)}` : null,
    languages: a.availableTranslatedLanguages || [],
  };
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of params) p.append(k, v);
  return p.toString();
}

async function listManga(url) {
  const lang = LANG.test(url.searchParams.get('lang') || '') ? url.searchParams.get('lang') : 'fr';
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const sort = url.searchParams.get('sort') || 'popular';
  const offset = Math.max(0, Math.min(9900, Number(url.searchParams.get('offset')) || 0));
  const params = [['limit', '24'], ['offset', String(offset)], ['includes[]', 'cover_art'], ['includes[]', 'author'], ['availableTranslatedLanguage[]', lang], ['hasAvailableChapters', 'true']];
  for (const r of RATINGS) params.push(['contentRating[]', r]);
  if (q) params.push(['title', q], ['order[relevance]', 'desc']);
  else if (sort === 'latest') params.push(['order[latestUploadedChapter]', 'desc']);
  else if (sort === 'rating') params.push(['order[rating]', 'desc']);
  else params.push(['order[followedCount]', 'desc']);
  const data = await apiGet('/manga?' + qs(params));
  return { total: data.total, offset, items: data.data.map((m) => simplifyManga(m, lang)) };
}

async function getManga(id, url) {
  const lang = LANG.test(url.searchParams.get('lang') || '') ? url.searchParams.get('lang') : 'fr';
  const data = await apiGet(`/manga/${id}?` + qs([['includes[]', 'cover_art'], ['includes[]', 'author']]));
  const manga = simplifyManga(data.data, lang);

  // Récupère tous les chapitres (pagination par 500).
  const chapters = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const params = [['limit', '500'], ['offset', String(offset)], ['translatedLanguage[]', lang], ['order[volume]', 'asc'], ['order[chapter]', 'asc'], ['includes[]', 'scanlation_group']];
    for (const r of [...RATINGS, 'erotica', 'pornographic']) params.push(['contentRating[]', r]);
    const feed = await apiGet(`/manga/${id}/feed?` + qs(params));
    for (const c of feed.data) {
      const a = c.attributes;
      if (a.externalUrl || a.pages === 0) continue; // chapitres hébergés ailleurs : illisibles ici
      const group = (c.relationships || []).find((r) => r.type === 'scanlation_group');
      chapters.push({ id: c.id, chapter: a.chapter, volume: a.volume, title: a.title, pages: a.pages, publishedAt: a.publishAt, group: group && group.attributes ? group.attributes.name : null });
    }
    if (offset + 500 >= feed.total) break;
  }
  // Dédoublonne : un seul upload par numéro de chapitre (le premier rencontré).
  const seen = new Set();
  manga.chapters = chapters.filter((c) => {
    const key = c.chapter == null ? c.id : c.chapter;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  manga.chapters.sort((x, y) => (parseFloat(x.chapter) || 0) - (parseFloat(y.chapter) || 0));
  return manga;
}

async function getPages(id, url) {
  const saver = url.searchParams.get('saver') === '1';
  // Les URLs du serveur "at-home" expirent vite : cache court.
  const data = await apiGet(`/at-home/server/${id}`, 60 * 1000);
  const files = saver ? data.chapter.dataSaver : data.chapter.data;
  const dir = saver ? 'data-saver' : 'data';
  return { pages: files.map((f) => `/img?u=${encodeURIComponent(`${data.baseUrl}/${dir}/${data.chapter.hash}/${f}`)}`) };
}

async function proxyImage(url, res) {
  let target;
  try { target = new URL(url.searchParams.get('u') || ''); } catch { return send(res, 400, { error: 'URL invalide' }); }
  const hostOk = IMAGE_HOSTS.some((re) => re.test(target.host)) && /^https?:$/.test(target.protocol);
  if (!hostOk) return send(res, 403, { error: 'Hôte non autorisé' });
  const up = await fetch(target, { headers: { 'User-Agent': UA } });
  if (!up.ok) return send(res, 502, { error: `Image indisponible (${up.status})` });
  const type = up.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return send(res, 502, { error: 'Contenu non image' });
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
  res.end(Buffer.from(await up.arrayBuffer()));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Interdit' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA : toute route inconnue renvoie l'index.
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, idx) => {
        if (e2) return send(res, 404, { error: 'Introuvable' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(idx);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/manga') return send(res, 200, await listManga(url));
    let m;
    if ((m = p.match(/^\/api\/manga\/([^/]+)$/)) && UUID.test(m[1])) return send(res, 200, await getManga(m[1], url));
    if ((m = p.match(/^\/api\/chapter\/([^/]+)\/pages$/)) && UUID.test(m[1])) return send(res, 200, await getPages(m[1], url));
    if (p === '/img') return await proxyImage(url, res);
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Route inconnue' });
    return serveStatic(p, res);
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) send(res, e.status || 502, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Manga-scan : http://localhost:${PORT}`));
}
module.exports = server;
