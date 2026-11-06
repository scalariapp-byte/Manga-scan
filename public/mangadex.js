// Accès aux données MangaDex, partagé entre la version web et l'APK.
// - Dans l'APK (Capacitor) : appels directs à api.mangadex.org via le HTTP natif (pas de CORS).
// - Dans le navigateur : passage par le serveur Node (/mdx et /img).
(function () {
  const cap = window.Capacitor;
  const NATIVE = !!(window.androidBridge || (cap && cap.isNativePlatform && cap.isNativePlatform()));
  const API = NATIVE ? 'https://api.mangadex.org' : '/mdx';
  const COVERS = 'https://uploads.mangadex.org';
  const img = (url) => (NATIVE ? url : '/img?u=' + encodeURIComponent(url));

  const RATINGS = ['safe', 'suggestive'];
  const cache = new Map();

  async function get(path, params, ttl = 5 * 60 * 1000) {
    const q = new URLSearchParams();
    for (const [k, v] of params || []) q.append(k, v);
    const url = API + path + (params ? '?' + q : '');
    const hit = cache.get(url);
    if (hit && hit.exp > Date.now()) return hit.data;
    const { status, data } = NATIVE ? await nativeGet(url) : await webGet(url);
    if (status === 429) throw new Error('MangaDex limite les requêtes : réessayez dans quelques secondes.');
    if (status < 200 || status >= 300) throw new Error(`MangaDex a répondu ${status}.`);
    if (!data || typeof data !== 'object') throw new Error('Réponse inattendue de MangaDex.');
    cache.set(url, { data, exp: Date.now() + ttl });
    return data;
  }

  // APK : requête HTTP native (pas de CORS, pas d'interception par le WebView).
  async function nativeGet(url) {
    const opts = { url, method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Manga-scan/1.0 (Android)' }, responseType: 'json' };
    let r;
    try {
      if (cap && cap.nativePromise) r = await cap.nativePromise('CapacitorHttp', 'request', opts);
      else if (cap && cap.Plugins && cap.Plugins.CapacitorHttp) r = await cap.Plugins.CapacitorHttp.request(opts);
      else return webGet(url);
    } catch (e) {
      throw new Error('Pas de connexion à MangaDex (' + ((e && e.message) || 'erreur réseau') + ').');
    }
    let data = r.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
    return { status: r.status, data };
  }

  async function webGet(url) {
    let r;
    try { r = await fetch(url, { headers: { Accept: 'application/json' } }); }
    catch { throw new Error('Pas de connexion à MangaDex. Vérifiez votre réseau.'); }
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data };
  }

  const pick = (obj, langs) => { if (!obj) return ''; for (const l of langs) if (obj[l]) return obj[l]; return Object.values(obj)[0] || ''; };

  function simplify(m, lang) {
    const a = m.attributes;
    let title = pick(a.title, [lang, 'fr', 'en', 'ja-ro', 'ja']);
    const alt = (a.altTitles || []).find((t) => t[lang]);
    if (alt && !a.title[lang]) title = alt[lang];
    const rel = m.relationships || [];
    const cover = rel.find((r) => r.type === 'cover_art');
    const author = rel.find((r) => r.type === 'author');
    return {
      id: m.id, title,
      description: pick(a.description, [lang, 'fr', 'en']),
      status: a.status, year: a.year,
      tags: (a.tags || []).map((t) => pick(t.attributes.name, [lang, 'en'])).slice(0, 8),
      author: author && author.attributes ? author.attributes.name : null,
      cover: cover && cover.attributes ? img(`${COVERS}/covers/${m.id}/${cover.attributes.fileName}.256.jpg`) : null,
    };
  }

  async function listManga({ lang, q, sort, offset = 0 }) {
    const p = [['limit', '24'], ['offset', String(offset)], ['includes[]', 'cover_art'], ['includes[]', 'author'], ['availableTranslatedLanguage[]', lang], ['hasAvailableChapters', 'true']];
    for (const r of RATINGS) p.push(['contentRating[]', r]);
    if (q) p.push(['title', q.slice(0, 100)], ['order[relevance]', 'desc']);
    else if (sort === 'latest') p.push(['order[latestUploadedChapter]', 'desc']);
    else if (sort === 'rating') p.push(['order[rating]', 'desc']);
    else p.push(['order[followedCount]', 'desc']);
    const data = await get('/manga', p);
    return { total: data.total, items: data.data.map((m) => simplify(m, lang)) };
  }

  async function getManga(id, lang) {
    const data = await get(`/manga/${id}`, [['includes[]', 'cover_art'], ['includes[]', 'author']]);
    const manga = simplify(data.data, lang);
    const chapters = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const p = [['limit', '500'], ['offset', String(offset)], ['translatedLanguage[]', lang], ['order[volume]', 'asc'], ['order[chapter]', 'asc'], ['includes[]', 'scanlation_group']];
      for (const r of [...RATINGS, 'erotica', 'pornographic']) p.push(['contentRating[]', r]);
      const feed = await get(`/manga/${id}/feed`, p);
      for (const c of feed.data) {
        const a = c.attributes;
        if (a.externalUrl || a.pages === 0) continue; // chapitres hébergés ailleurs : illisibles ici
        const g = (c.relationships || []).find((r) => r.type === 'scanlation_group');
        chapters.push({ id: c.id, chapter: a.chapter, volume: a.volume, title: a.title, publishedAt: a.publishAt, group: g && g.attributes ? g.attributes.name : null });
      }
      if (offset + 500 >= feed.total) break;
    }
    const seen = new Set();
    manga.chapters = chapters.filter((c) => { const k = c.chapter == null ? c.id : c.chapter; if (seen.has(k)) return false; seen.add(k); return true; });
    manga.chapters.sort((x, y) => (parseFloat(x.chapter) || 0) - (parseFloat(y.chapter) || 0));
    return manga;
  }

  async function getPages(chapterId, saver) {
    const d = await get(`/at-home/server/${chapterId}`, null, 60 * 1000); // URLs à durée de vie courte
    const files = saver ? d.chapter.dataSaver : d.chapter.data;
    const dir = saver ? 'data-saver' : 'data';
    return files.map((f) => img(`${d.baseUrl}/${dir}/${d.chapter.hash}/${f}`));
  }

  window.MangaDex = { listManga, getManga, getPages, NATIVE };
})();
