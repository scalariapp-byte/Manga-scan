// Accès aux données MangaDex, partagé entre la version web et l'APK.
// - Dans l'APK (Capacitor) : appels directs à api.mangadex.org via le HTTP natif (pas de CORS).
// - Dans le navigateur : passage par le serveur Node (/mdx et /img).
(function () {
  const cap = window.Capacitor;
  const NATIVE = !!(window.androidBridge || (cap && cap.isNativePlatform && cap.isNativePlatform()));
  const API = NATIVE ? 'https://api.mangadex.org' : '/mdx';
  const COVERS = 'https://uploads.mangadex.org';
  const img = (url) => (NATIVE ? url : '/img?u=' + encodeURIComponent(url));
  const UA = 'Manga-scan/1.0 (Android)';

  const RATINGS = ['safe', 'suggestive'];
  const mem = new Map();       // url -> { data, at }
  const inflight = new Map();  // url -> Promise (évite les requêtes en double, ex. préchargement)

  // Cache persistant (survit à la fermeture de l'app) pour un affichage instantané.
  const PKEY = 'mdx-cache-v1', PMAX = 40, STALE_MAX = 7 * 24 * 3600 * 1000;
  let disk = {};
  try { disk = JSON.parse(localStorage.getItem(PKEY)) || {}; } catch {}
  let saveTimer = null;
  function persist(url, entry) {
    disk[url] = entry;
    const keys = Object.keys(disk);
    if (keys.length > PMAX) keys.sort((a, b) => disk[a].at - disk[b].at).slice(0, keys.length - PMAX).forEach((k) => delete disk[k]);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(PKEY, JSON.stringify(disk)); }
    catch { disk = {}; try { localStorage.removeItem(PKEY); } catch {} }
  }
  // Sauvegarde aussi quand l'app passe en arrière-plan ou se ferme.
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // Stratégie « stale-while-revalidate » : une donnée en cache est renvoyée immédiatement ;
  // si elle a plus de `ttl`, elle est rafraîchie en arrière-plan pour la prochaine fois.
  async function get(path, params, ttl = 10 * 60 * 1000, keep = true, force = false) {
    const q = new URLSearchParams();
    for (const [k, v] of params || []) q.append(k, v);
    const url = API + path + (params ? '?' + q : '');
    if (force) return fetchJson(url, keep);
    const hit = mem.get(url) || (keep && disk[url]);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < ttl) return hit.data;
    if (hit && keep && age < STALE_MAX) { fetchJson(url, keep).catch(() => {}); return hit.data; }
    return fetchJson(url, keep);
  }

  function fetchJson(url, keep) {
    if (inflight.has(url)) return inflight.get(url);
    const p = doFetch(url, keep).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  async function doFetch(url, keep) {
    const { status, data } = NATIVE ? await nativeGet(url) : await webGet(url);
    if (status === 429) throw new Error('MangaDex limite les requêtes : réessayez dans quelques secondes.');
    if (status < 200 || status >= 300) throw new Error(`MangaDex a répondu ${status}.`);
    if (!data || typeof data !== 'object') throw new Error('Réponse inattendue de MangaDex.');
    const entry = { data, at: Date.now() };
    mem.set(url, entry);
    if (keep) persist(url, entry);
    return data;
  }

  // APK : requête HTTP native (pas de CORS, pas d'interception par le WebView).
  async function nativeGet(url) {
    const opts = { url, method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA }, responseType: 'json' };
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

  // Liens « officiels » fournis par MangaDex (éditeur, plateformes légales, librairies).
  const LINKS = {
    engtl: (v) => ['Éditeur (anglais)', v],
    raw: (v) => ['Éditeur japonais', v],
    bw: (v) => ['BookWalker', 'https://bookwalker.jp/' + v],
    amz: (v) => ['Amazon', v],
    ebj: (v) => ['eBookJapan', v],
    cdj: (v) => ['CDJapan', v],
  };
  function officialLinks(l) {
    const out = [];
    for (const [k, f] of Object.entries(LINKS)) {
      if (!l[k]) continue;
      const [label, url] = f(l[k]);
      if (/^https?:\/\//.test(url)) out.push({ label, url });
    }
    return out;
  }

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
      languages: a.availableTranslatedLanguages || [],
      links: officialLinks(a.links || {}),
      tags: (a.tags || []).map((t) => pick(t.attributes.name, [lang, 'en'])).slice(0, 8),
      author: author && author.attributes ? author.attributes.name : null,
      cover: cover && cover.attributes ? img(`${COVERS}/covers/${m.id}/${cover.attributes.fileName}.256.jpg`) : null,
    };
  }

  async function listManga({ lang, q, sort, offset = 0 }) {
    const p = [['limit', '24'], ['offset', String(offset)], ['includes[]', 'cover_art'], ['includes[]', 'author'], ['hasAvailableChapters', 'true']];
    // La recherche couvre toutes les langues (la fiche propose ensuite les langues disponibles) ;
    // les listes de découverte, elles, ne montrent que ce qui est lisible dans la langue choisie.
    if (!q) p.push(['availableTranslatedLanguage[]', lang]);
    for (const r of RATINGS) p.push(['contentRating[]', r]);
    if (q) p.push(['title', q.slice(0, 100)], ['order[relevance]', 'desc']);
    else if (sort === 'latest') p.push(['order[latestUploadedChapter]', 'desc']);
    else if (sort === 'rating') p.push(['order[rating]', 'desc']);
    else p.push(['order[followedCount]', 'desc']);
    const data = await get('/manga', p);
    const items = data.data.map((m) => simplify(m, lang));
    items.forEach((m) => known.set(m.id, m));
    return { total: data.total, items };
  }

  const known = new Map(); // résumés déjà vus dans les listes : affichage immédiat de la fiche
  const summary = (id) => known.get(id) || null;

  const feedPage = (id, langs, offset, force) => {
    const p = [['limit', '500'], ['offset', String(offset)], ['order[volume]', 'asc'], ['order[chapter]', 'asc']];
    for (const l of langs) p.push(['translatedLanguage[]', l]);
    for (const r of [...RATINGS, 'erotica', 'pornographic']) p.push(['contentRating[]', r]);
    return get(`/manga/${id}/feed`, p, undefined, true, force);
  };

  // fill = true : les chapitres absents dans `lang` sont complétés par la version anglaise.
  async function getManga(id, lang, force = false, fill = true) {
    const langs = fill && lang !== 'en' ? [lang, 'en'] : [lang];
    // Fiche et premier lot de chapitres en parallèle.
    const [data, first] = await Promise.all([get(`/manga/${id}`, [['includes[]', 'cover_art'], ['includes[]', 'author']], 60 * 60 * 1000), feedPage(id, langs, 0, force)]);
    const manga = simplify(data.data, lang);
    known.set(id, manga);
    const feeds = [first];
    if (first.total > 500) {
      const offsets = [];
      for (let o = 500; o < Math.min(first.total, 10000); o += 500) offsets.push(o);
      feeds.push(...(await Promise.all(offsets.map((o) => feedPage(id, langs, o, force)))));
    }
    const chapters = [];
    for (const feed of feeds) for (const c of feed.data) {
      const a = c.attributes;
      // Chapitres publiés par un éditeur officiel : pas d'images sur MangaDex, on garde le lien externe.
      const external = a.externalUrl || null;
      if (!external && a.pages === 0) continue;
      chapters.push({ id: c.id, chapter: a.chapter, volume: a.volume, title: a.title, publishedAt: a.publishAt, external, lang: a.translatedLanguage });
    }
    // En cas de doublon, priorité : langue choisie lisible > autre langue lisible > liens officiels.
    const rank = (c) => (c.external ? 2 : 0) + (c.lang === lang ? 0 : 1);
    chapters.sort((x, y) => rank(x) - rank(y));
    const seen = new Set();
    manga.chapters = chapters.filter((c) => { const k = c.chapter == null ? c.id : c.chapter; if (seen.has(k)) return false; seen.add(k); return true; });
    manga.chapters.sort((x, y) => (parseFloat(x.chapter) || 0) - (parseFloat(y.chapter) || 0));
    return manga;
  }

  async function getPages(chapterId, saver) {
    const d = await get(`/at-home/server/${chapterId}`, null, 5 * 60 * 1000, false); // URLs temporaires : jamais sur disque
    const light = saver && d.chapter.dataSaver && d.chapter.dataSaver.length > 0;
    const files = light ? d.chapter.dataSaver : d.chapter.data;
    const dir = light ? 'data-saver' : 'data';
    return files.map((f) => img(`${d.baseUrl}/${dir}/${d.chapter.hash}/${f}`));
  }

  // ---- Images ----
  // Dans l'APK, les images passent par le HTTP natif (comme les données) : le WebView ajoute des en-têtes
  // (X-Requested-With, Referer…) que les serveurs d'images de MangaDex refusent.
  // Résultat converti en URL blob, avec un cache LRU et au plus 6 téléchargements simultanés.
  const blobs = new Map(); // url -> Promise<blobUrl>
  const BLOB_MAX = 200;
  let active = 0;
  const queue = [];
  const runQueued = () => {
    while (active < 6 && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; runQueued(); });
    }
  };
  const enqueue = (fn, urgent) => new Promise((resolve, reject) => {
    const job = () => fn().then(resolve, reject);
    urgent ? queue.unshift(job) : queue.push(job);
    runQueued();
  });

  async function nativeImage(url) {
    const r = await cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', responseType: 'blob', headers: { 'User-Agent': UA, Accept: 'image/*' } });
    if (r.status < 200 || r.status >= 300) throw new Error('Image ' + r.status);
    const h = r.headers || {};
    const type = (h['Content-Type'] || h['content-type'] || 'image/jpeg').split(';')[0];
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type }));
  }

  function loadImage(url, urgent = false) {
    if (!NATIVE || !(cap && cap.nativePromise)) return Promise.resolve(url);
    if (blobs.has(url)) { const p = blobs.get(url); blobs.delete(url); blobs.set(url, p); return p; }
    const p = enqueue(() => nativeImage(url), urgent);
    p.catch(() => blobs.delete(url));
    blobs.set(url, p);
    if (blobs.size > BLOB_MAX) {
      const [oldUrl, oldP] = blobs.entries().next().value;
      blobs.delete(oldUrl);
      oldP.then((b) => setTimeout(() => URL.revokeObjectURL(b), 30000)).catch(() => {});
    }
    return p;
  }

  // Télécharge à l'avance les premières pages d'un chapitre.
  const warmed = new Set();
  async function prefetchChapter(chapterId, saver, count = 4) {
    const key = chapterId + saver;
    if (warmed.has(key)) return;
    warmed.add(key);
    try {
      const pages = await getPages(chapterId, saver);
      pages.slice(0, count).forEach((src) => {
        if (NATIVE) loadImage(src).catch(() => {});
        else { const im = new Image(); im.src = src; }
      });
    } catch { warmed.delete(key); }
  }

  // Ouvre une page (chapitre d'un éditeur officiel) dans un navigateur intégré plein écran,
  // sans barre d'adresse : on reste dans l'app, un bouton « Fermer » ramène à la liste.
  async function openExternal(url, showURL = false) {
    if (!NATIVE || !(cap && cap.nativePromise)) { window.open(url, '_blank', 'noopener'); return; }
    try {
      await cap.nativePromise('InAppBrowser', 'openInWebView', {
        url,
        options: {
          showURL, showToolbar: true, clearCache: false, clearSessionCache: false,
          mediaPlaybackRequiresUserAction: false, closeButtonText: 'Fermer', toolbarPosition: 0,
          showNavigationButtons: true, leftToRight: false, customWebViewUserAgent: null,
          android: { allowZoom: true, hardwareBack: true, pauseMedia: true },
          iOS: { allowOverScroll: true, enableViewportScale: false, allowInLineMediaPlayback: false, surpressIncrementalRendering: false, viewStyle: 2, animationEffect: 2, allowsBackForwardNavigationGestures: true },
        },
      });
    } catch {
      location.href = url; // repli : navigateur système
    }
  }

  // Notifie chaque page chargée dans le navigateur intégré (pour reprendre où on s'était arrêté).
  function onBrowse(cb) {
    if (!NATIVE || !(cap && cap.addListener)) return;
    try { cap.addListener('InAppBrowser', 'browserPageNavigationCompleted', (d) => d && d.url && cb(d.url)); } catch {}
  }

  window.MangaDex = { listManga, getManga, getPages, prefetchChapter, loadImage, openExternal, onBrowse, summary, NATIVE };
})();
