// Serveur Manga-scan (version web) : sert l'interface et relaie l'API MangaDex et ses images.
// L'APK Android n'en a pas besoin : il appelle MangaDex directement.
// Aucune dépendance : Node >= 18 (fetch natif).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const API = (process.env.MANGADEX_API || 'https://api.mangadex.org').replace(/\/$/, '');
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
    err.status = [404, 429].includes(res.status) ? res.status : 502;
    throw err;
  }
  const data = await res.json();
  cache.set(pathAndQuery, { data, exp: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// Seules ces routes de l'API MangaDex sont relayées.
const ALLOWED = [/^\/manga$/, /^\/manga\/[0-9a-f-]{36}$/i, /^\/manga\/[0-9a-f-]{36}\/feed$/i, /^\/at-home\/server\/[0-9a-f-]{36}$/i];

async function proxyApi(url, res) {
  const sub = url.pathname.slice('/mdx'.length);
  if (!ALLOWED.some((re) => re.test(sub))) return send(res, 404, { error: 'Route inconnue' });
  const ttl = sub.startsWith('/at-home') ? 60 * 1000 : 5 * 60 * 1000;
  send(res, 200, await apiGet(sub + url.search, ttl));
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
    if (p.startsWith('/mdx/')) return await proxyApi(url, res);
    if (p === '/img') return await proxyImage(url, res);
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
