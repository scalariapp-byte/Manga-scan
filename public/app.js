// Manga-scan — interface (vanilla JS, routage par hash).
const $app = document.getElementById('app');
const $lang = document.getElementById('lang');
const $q = document.getElementById('q');

// ---------- Stockage local (favoris, progression) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let lang = store.get('lang', 'fr');
$lang.value = lang;
const favs = () => store.get('favs', {});            // id -> {id,title,cover}
const history = () => store.get('history', {});      // mangaId -> {id,title,cover,chapterId,chapter,page,at}
const readSet = () => store.get('read', {});         // chapterId -> true

function toggleFav(m) {
  const f = favs();
  if (f[m.id]) delete f[m.id]; else f[m.id] = { id: m.id, title: m.title, cover: m.cover };
  store.set('favs', f);
}

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fillOn = () => store.get('fill', true); // compléter les chapitres manquants avec l'anglais
const saverOn = () => store.get('saver', true); // pages allégées par défaut : 3 à 5 fois plus légères
const LANGS = { fr: 'Français', en: 'Anglais', 'es-la': 'Espagnol', es: 'Espagnol (ES)', 'pt-br': 'Portugais', it: 'Italien', de: 'Allemand' };
const STATUS = { ongoing: 'En cours', completed: 'Terminé', hiatus: 'En pause', cancelled: 'Annulé' };
const chLabel = (c) => (c.chapter ? `Chapitre ${c.chapter}` : 'Oneshot') + (c.title ? ` — ${c.title}` : '');
const coverImg = (src) => (src ? `<img data-src="${esc(src)}" alt="">` : '');
const card = (m, sub = '', href = `#/manga/${m.id}`) => `
  <a class="card" href="${href}">
    <div class="cover">${coverImg(m.cover)}${sub ? `<span class="badge">${esc(sub)}</span>` : ''}</div>
    <div class="t">${esc(m.title)}</div>
  </a>`;
const skeletons = (n) => Array.from({ length: n }, () => '<div class="card skel"><div class="cover"></div><div class="t" style="margin-top:8px"></div></div>').join('');
const errorBox = (e) => `<div class="err"><b>Impossible de charger</b>${esc(e.message)}<br><button class="btn primary" onclick="route()">Réessayer</button></div>`;

// ---------- Accueil / recherche ----------
let listState = { sort: 'popular', q: '', offset: 0 };

async function viewHome(q = '') {
  document.title = 'Manga-scan';
  listState = { sort: listState.sort, q, offset: 0 };
  const h = Object.values(history()).sort((a, b) => b.at - a.at).slice(0, 20);
  const f = Object.values(favs());
  $app.innerHTML = `
    ${!q && h.length ? `<h2>Continuer la lecture</h2><div class="row">${h.map((x) => card(x, `Ch. ${x.chapter ?? '?'}`, `#/read/${x.id}/${x.chapterId}`)).join('')}</div>` : ''}
    ${!q && f.length ? `<h2>Favoris</h2><div class="row">${f.map((m) => card(m)).join('')}</div>` : ''}
    <h2>${q ? `Résultats pour « ${esc(q)} »` : 'Découvrir'}</h2>
    ${q ? '' : `<div class="tabs">
      ${[['popular', 'Populaires'], ['latest', 'Mis à jour'], ['rating', 'Mieux notés']].map(([k, l]) =>
        `<button class="tab ${listState.sort === k ? 'active' : ''}" data-sort="${k}">${l}</button>`).join('')}
    </div>`}
    <div class="grid" id="grid"></div>
    <div class="more" id="more"></div>`;
  $app.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => { listState.sort = b.dataset.sort; viewHome(); });
  loadMore();
}

async function loadMore() {
  const $grid = document.getElementById('grid'), $more = document.getElementById('more');
  if (!$grid) return;
  $more.innerHTML = '';
  $grid.insertAdjacentHTML('beforeend', skeletons(listState.offset ? 6 : 12));
  try {
    const data = await MangaDex.listManga({ lang, q: listState.q, sort: listState.sort, offset: listState.offset });
    if (!document.getElementById('grid')) return; // l'utilisateur a changé de page
    $grid.querySelectorAll('.skel').forEach((el) => el.remove());
    $grid.insertAdjacentHTML('beforeend', data.items.map((m) => card(m)).join(''));
    listState.offset += data.items.length;
    if (!listState.offset) $more.innerHTML = '<p class="msg">Aucun manga trouvé dans cette langue.</p>';
    else if (listState.offset < data.total && data.items.length) {
      $more.innerHTML = '<button class="btn">Voir plus</button>';
      $more.firstChild.onclick = loadMore;
    } else $more.innerHTML = '';
  } catch (e) { $grid.querySelectorAll('.skel').forEach((el) => el.remove()); $more.innerHTML = errorBox(e); }
}

// ---------- Fiche manga ----------
const mangaCache = new Map();
async function getManga(id) {
  const key = id + ':' + lang + ':' + fillOn();
  if (!mangaCache.has(key)) mangaCache.set(key, MangaDex.getManga(id, lang, false, fillOn()).catch((e) => { mangaCache.delete(key); throw e; }));
  return mangaCache.get(key);
}

async function viewManga(id) {
  // Affichage immédiat avec ce qu'on connaît déjà (liste, favoris, historique), chapitres ensuite.
  const quick = MangaDex.summary(id) || favs()[id] || history()[id];
  let m = quick ? { tags: [], ...quick, chapters: null } : null;
  const read = readSet();
  const hist = history()[id];
  let desc = true; // ordre décroissant par défaut
  const render = () => {
    document.title = m.title + ' — Manga-scan';
    const isFav = !!favs()[id];
    const first = m.chapters && m.chapters.find((c) => !c.external);
    const list = !m.chapters ? [] : desc ? [...m.chapters].reverse() : m.chapters;
    const nExt = m.chapters ? m.chapters.filter((c) => c.external).length : 0;
    const otherLangs = (m.languages || []).filter((l) => l !== lang && LANGS[l]);
    $app.innerHTML = `
      <div class="hero">
        ${m.cover ? `<img class="bg" data-src="${esc(m.cover)}" data-eager="1" alt="">` : ''}
        <div class="detail">
          <div>${m.cover ? `<img class="cover" data-src="${esc(m.cover)}" data-eager="1" alt="">` : ''}</div>
          <div>
            <h1>${esc(m.title)}</h1>
            <div class="meta">${[m.author, m.year, STATUS[m.status] || m.status].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="tags">${m.tags.slice(0, 5).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
          </div>
        </div>
      </div>
          <div class="actions">
            ${hist ? `<a class="btn primary" href="#/read/${id}/${hist.chapterId}">Reprendre ch. ${esc(hist.chapter ?? '?')}</a>` : ''}
            ${first ? `<a class="btn ${hist ? '' : 'primary'}" href="#/read/${id}/${first.id}">Commencer</a>` : ''}
            <button class="btn" id="fav">${isFav ? '★ Favori' : '☆ Favori'}</button>
          </div>
          ${m.links && m.links.length ? `<div class="official"><span class="meta">Lire la série complète légalement :</span>
            <div class="tabs">${m.links.map((l) => `<button class="tab" data-ext="${esc(l.url)}">${esc(l.label)} ↗</button>`).join('')}</div></div>` : ''}
          ${m.description ? `<div class="desc" id="desc">${esc(m.description)}</div>` : ''}
      <div class="chhead"><h2>${m.chapters ? m.chapters.length : '…'} chapitres <span class="meta">(${esc(lang.toUpperCase())})</span></h2>
        <div class="tabs" style="margin:0">${lang !== 'en' ? `<button class="tab ${fillOn() ? 'active' : ''}" id="fill" title="Compléter les chapitres manquants avec l'anglais">+EN</button>` : ''}
        <button class="btn" id="order">${desc ? '↓' : '↑'}</button></div></div>
      ${!m.chapters ? `<ul class="chapters">${'<li class="skel"><a><span class="t" style="width:40%"></span></a></li>'.repeat(8)}</ul>` : m.chapters.length ? `<ul class="chapters">${list.map((c) => `
        <li><a href="${c.external ? '#' : `#/read/${id}/${c.id}`}" ${c.external ? `data-ext="${esc(c.external)}"` : ''} class="${read[c.id] ? 'read' : ''}">
          <span class="name">${esc(chLabel(c))}${c.lang && c.lang !== lang ? ` <span class="lng">${esc(c.lang.split('-')[0].toUpperCase())}</span>` : ''}${c.external ? ' <span class="ext">Éditeur officiel</span>' : ''}</span>
          <small>${c.volume ? `Vol. ${esc(c.volume)}<br>` : ''}${c.publishedAt ? new Date(c.publishedAt).toLocaleDateString('fr-FR') : ''}</small>
        </a></li>`).join('')}</ul>`
      : `<div class="err"><b>Aucun chapitre en ${esc(LANGS[lang] || lang)} sur MangaDex</b>${otherLangs.length ? 'Disponible en :' : 'Ce manga a probablement été retiré de MangaDex (licence).'}
          ${otherLangs.length ? `<div class="actions" style="justify-content:center">${otherLangs.map((l) => `<button class="btn" data-lang="${l}">${esc(LANGS[l])}</button>`).join('')}</div>` : ''}</div>`}
      ${nExt ? `<p class="meta" style="margin-top:12px">Les chapitres « Éditeur officiel » sont publiés gratuitement par l'éditeur : ils s'ouvrent dans le lecteur intégré, touchez « Fermer » pour revenir.</p>` : ''}`;
    const fb = document.getElementById('fill');
    if (fb) fb.onclick = () => { store.set('fill', !fillOn()); route(); };
    $app.querySelectorAll('[data-ext]').forEach((a) => a.onclick = (e) => { e.preventDefault(); MangaDex.openExternal(a.dataset.ext); });
    $app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { lang = b.dataset.lang; $lang.value = lang; store.set('lang', lang); route(); });
    document.getElementById('fav').onclick = () => { toggleFav(m); render(); };
    document.getElementById('order').onclick = () => { desc = !desc; render(); };
    const d = document.getElementById('desc'); if (d) d.onclick = () => d.classList.toggle('open');
  };
  if (m) render(); else $app.innerHTML = '<div class="grid" style="margin-top:20px">' + skeletons(6) + '</div>';
  const here = location.hash;
  let full;
  try { full = await getManga(id); } catch (e) { if (location.hash === here) $app.innerHTML = errorBox(e); return; }
  if (location.hash !== here) return; // l'utilisateur est parti entre-temps
  m = full;
  render();
  // Si la liste venait du cache, on vérifie en arrière-plan s'il y a de nouveaux chapitres.
  MangaDex.getManga(id, lang, true, fillOn()).then((fresh) => {
    if (location.hash !== here || fresh.chapters.length === m.chapters.length) return;
    mangaCache.set(id + ':' + lang + ':' + fillOn(), Promise.resolve(fresh));
    m = fresh; render();
  }).catch(() => {});
  // Le chapitre le plus probable (reprise ou premier) est préchargé pour une ouverture instantanée.
  const firstReadable = m.chapters.find((c) => !c.external);
  const likely = (hist && hist.chapterId) || (firstReadable && firstReadable.id);
  if (likely) MangaDex.prefetchChapter(likely, saverOn());
}

// ---------- Onglet Web : navigateur intégré généraliste ----------
// L'utilisateur navigue lui-même sur les sites de son choix ; l'app ne récupère pas leur contenu.
const webFavs = () => store.get('webfavs', []);           // [{ title, url }]
const webLast = () => store.get('weblast', {});          // host -> dernière URL visitée
const webRecent = () => store.get('webrecent', []);      // [{ url, at }] (10 derniers)
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

function toUrl(input) {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return 'https://' + t; // ressemble à un domaine
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(t);
}
function browse(url, resume = true) {
  const last = resume ? webLast()[hostOf(url)] : null;
  MangaDex.openExternal(last || url, true);
}
MangaDex.onBrowse((url) => {
  const host = hostOf(url);
  if (!host || host.endsWith('duckduckgo.com')) return;
  const l = webLast(); l[host] = url; store.set('weblast', l);
  const r = webRecent().filter((x) => hostOf(x.url) !== host);
  r.unshift({ url, at: Date.now() }); store.set('webrecent', r.slice(0, 10));
});

function viewWeb() {
  document.title = 'Web — Manga-scan';
  const render = () => {
    const favs = webFavs(), recent = webRecent(), last = webLast();
    $app.innerHTML = `
      <h2>Web</h2>
      <form id="wform" class="search"><input id="wq" type="search" inputmode="url" placeholder="Adresse d'un site ou recherche…" autocomplete="off"></form>
      <h2>Mes sites</h2>
      ${favs.length ? `<ul class="chapters">${favs.map((f, i) => `
        <li><a href="#" data-open="${i}"><span class="name">${esc(f.title)}<br><small>${esc(hostOf(f.url))}${last[hostOf(f.url)] ? ' · reprise à la dernière page' : ''}</small></span>
          <button class="btn" data-del="${i}" aria-label="Retirer">✕</button></a></li>`).join('')}</ul>`
        : '<p class="meta">Aucun site enregistré. Ajoutez-en un ci-dessous.</p>'}
      <form id="addf" class="addsite">
        <input id="aname" placeholder="Nom (ex. : Mon site)" autocomplete="off">
        <input id="aurl" placeholder="Adresse (ex. : exemple.com)" inputmode="url" autocomplete="off">
        <button class="btn primary">Ajouter</button>
      </form>
      ${recent.length ? `<h2>Récents</h2><ul class="chapters">${recent.map((r) => `
        <li><a href="#" data-url="${esc(r.url)}"><span class="name">${esc(hostOf(r.url))}<br><small>${esc(r.url.length > 60 ? r.url.slice(0, 60) + '…' : r.url)}</small></span>
          <small>${new Date(r.at).toLocaleDateString('fr-FR')}</small></a></li>`).join('')}</ul>` : ''}`;
    document.getElementById('wform').onsubmit = (e) => { e.preventDefault(); const u = toUrl(document.getElementById('wq').value); if (u) browse(u, false); };
    document.getElementById('addf').onsubmit = (e) => {
      e.preventDefault();
      const url = toUrl(document.getElementById('aurl').value);
      if (!url || url.includes('duckduckgo.com/?q=')) { document.getElementById('aurl').focus(); return; }
      const title = document.getElementById('aname').value.trim() || hostOf(url);
      store.set('webfavs', [...webFavs(), { title, url }]); render();
    };
    $app.querySelectorAll('[data-open]').forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      if (e.target.closest('[data-del]')) return;
      browse(webFavs()[+a.dataset.open].url);
    });
    $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = webFavs(); f.splice(+b.dataset.del, 1); store.set('webfavs', f); render();
    });
    $app.querySelectorAll('[data-url]').forEach((a) => a.onclick = (e) => { e.preventDefault(); MangaDex.openExternal(a.dataset.url, true); });
  };
  render();
}

// ---------- Lecteur ----------
let readerCleanup = null;
async function viewReader(mangaId, chapterId) {
  document.body.classList.add('reading');
  $app.innerHTML = '<p class="msg" style="padding-top:40vh">Chargement du chapitre…</p>';
  let m, pages;
  try {
    [m, pages] = await Promise.all([getManga(mangaId), MangaDex.getPages(chapterId, saverOn())]);
  } catch (e) { $app.innerHTML = errorBox(e) + '<p class="msg"><a class="btn" href="#/manga/' + esc(mangaId) + '">Retour</a></p>'; return; }
  const chs = m.chapters.filter((c) => !c.external);
  const idx = chs.findIndex((c) => c.id === chapterId);
  const ch = chs[idx] || { id: chapterId, chapter: null };
  const prev = chs[idx - 1], next = chs[idx + 1];
  document.title = `${m.title} — ${chLabel(ch)}`;
  let mode = store.get('mode', 'vertical');
  const h = history();
  const startPage = h[mangaId] && h[mangaId].chapterId === chapterId ? h[mangaId].page || 0 : 0;

  const save = (page) => {
    const hh = history();
    hh[mangaId] = { id: mangaId, title: m.title, cover: m.cover, chapterId, chapter: ch.chapter, page, at: Date.now() };
    store.set('history', hh);
    if (page >= pages.length - 1) { const r = readSet(); r[chapterId] = true; store.set('read', r); }
  };
  save(startPage);

  const go = (c) => { if (c) location.hash = `#/read/${mangaId}/${c.id}`; };
  const shell = (body) => `
    <div class="rbar" id="rbar">
      <a class="btn" href="#/manga/${mangaId}" title="Retour">←</a>
      <div class="ttl"><b>${esc(m.title)}</b>
      <select id="chsel">${chs.map((c) => `<option value="${c.id}" ${c.id === chapterId ? 'selected' : ''}>${esc(chLabel(c))}</option>`).join('')}</select></div>
      <button class="btn" id="hd" title="Qualité des images">${saverOn() ? 'SD' : 'HD'}</button>
      <button class="btn" id="mode" title="Mode de lecture">${mode === 'vertical' ? '⇕' : '⇔'}</button>
    </div>${body}`;
  const endnav = `<div class="endnav">
      <button class="btn" id="prevch" ${prev ? '' : 'disabled'}>← Précédent</button>
      <button class="btn primary" id="nextch" ${next ? '' : 'disabled'}>${next ? 'Chapitre suivant →' : 'Dernier chapitre'}</button></div>`;

  let cleanups = [];
  const render = () => {
    cleanups.forEach((f) => f()); cleanups = [];
    if (mode === 'vertical') {
      $app.innerHTML = shell(`<div class="pages">${pages.map((src, i) => `<img data-i="${i}" data-src="${esc(src)}" ${i < 3 ? 'data-eager="1"' : ''} alt="Page ${i + 1}">`).join('')}</div>${endnav}<div class="counter" id="counter"></div>`);
      const imgs = [...$app.querySelectorAll('.pages img')];
      const counter = document.getElementById('counter');
      let current = startPage;
      const obs = new IntersectionObserver((ents) => {
        for (const e of ents) if (e.isIntersecting) { current = +e.target.dataset.i; counter.textContent = `${current + 1} / ${pages.length}`; save(current); }
      }, { rootMargin: '-45% 0px -45% 0px' });
      imgs.forEach((im) => obs.observe(im));
      cleanups.push(() => obs.disconnect());
      counter.textContent = `${startPage + 1} / ${pages.length}`;
      if (startPage > 0) setTimeout(() => imgs[startPage]?.scrollIntoView(), 50);
      // Masque la barre en descendant
      let lastY = scrollY; const bar = document.getElementById('rbar');
      const onScroll = () => { bar.classList.toggle('hide', scrollY > lastY && scrollY > 80); lastY = scrollY; };
      addEventListener('scroll', onScroll, { passive: true });
      document.querySelector('.pages').onclick = () => bar.classList.toggle('hide');
      cleanups.push(() => removeEventListener('scroll', onScroll));
    } else {
      let page = startPage;
      $app.innerHTML = shell(`<div class="paged" id="paged"><img id="pimg" alt=""></div><div class="counter" id="counter"></div>`);
      const img = document.getElementById('pimg'), counter = document.getElementById('counter');
      const show = () => {
        img.removeAttribute('src'); img.dataset.src = pages[page]; setSrc(img, true);
        counter.textContent = `${page + 1} / ${pages.length}`; save(page);
        [1, 2, 3].forEach((k) => { if (pages[page + k]) MangaDex.loadImage(pages[page + k]).catch(() => {}); }); // préchargement
      };
      const step = (d) => {
        const p = page + d;
        if (p < 0) return go(prev);
        if (p >= pages.length) return go(next);
        page = p; show();
      };
      document.getElementById('paged').onclick = (e) => {
        const x = e.clientX / innerWidth;
        if (x < 1 / 3) step(-1); else if (x > 2 / 3) step(1); else document.getElementById('rbar').classList.toggle('hide');
      };
      const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); } if (e.key === 'ArrowLeft') step(-1); };
      addEventListener('keydown', onKey);
      cleanups.push(() => removeEventListener('keydown', onKey));
      show();
    }
    document.getElementById('chsel').onchange = (e) => go({ id: e.target.value });
    document.getElementById('hd').onclick = () => { store.set('saver', !saverOn()); viewReader(mangaId, chapterId); };
    document.getElementById('mode').onclick = () => { mode = mode === 'vertical' ? 'paged' : 'vertical'; store.set('mode', mode); render(); };
    const pv = document.getElementById('prevch'), nx = document.getElementById('nextch');
    if (pv) pv.onclick = () => go(prev);
    if (nx) nx.onclick = () => go(next);
  };
  render();
  // Chapitre suivant téléchargé en arrière-plan pendant la lecture.
  const pre = next ? setTimeout(() => MangaDex.prefetchChapter(next.id, saverOn(), 6), 2500) : null;
  readerCleanup = () => { clearTimeout(pre); cleanups.forEach((f) => f()); };
}

// ---------- Chargement des images ----------
// Toutes les images portent data-src ; elles sont chargées (via MangaDex.loadImage) à l'approche de l'écran.
function setSrc(im, urgent) {
  const want = im.dataset.src;
  MangaDex.loadImage(want, urgent).then((u) => {
    if (im.dataset.src !== want) return; // l'image a changé entre-temps (mode page par page)
    im.onload = () => im.classList.add('ok', 'loaded');
    im.onerror = () => retryImg(im);
    im.src = u;
  }).catch(() => retryImg(im));
}
// Les serveurs d'images MangaDex@Home tombent parfois : on réessaie une fois avec un délai.
function retryImg(im) {
  if (im.dataset.retry) { im.classList.add('fail'); return; }
  im.dataset.retry = '1';
  setTimeout(() => setSrc(im, true), 1500);
}
const imgObs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { imgObs.unobserve(e.target); setSrc(e.target, false); }
}, { rootMargin: '1200px 0px' });
function hydrate() {
  $app.querySelectorAll('img[data-src]:not([data-h])').forEach((im) => {
    im.dataset.h = '1';
    if (im.dataset.eager) setSrc(im, true); else imgObs.observe(im);
  });
}
new MutationObserver(hydrate).observe($app, { childList: true, subtree: true });

// ---------- Routage ----------
function route() {
  if (readerCleanup) { readerCleanup(); readerCleanup = null; }
  document.body.classList.remove('reading');
  scrollTo(0, 0);
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'manga' && parts[1]) return viewManga(parts[1]);
  if (parts[0] === 'read' && parts[2]) return viewReader(parts[1], parts[2]);
  document.getElementById('webbtn').classList.toggle('active', parts[0] === 'web');
  if (parts[0] === 'web') { $q.value = ''; return viewWeb(); }
  if (parts[0] === 'search') { $q.value = parts[1] || ''; return viewHome(parts[1] || ''); }
  $q.value = '';
  return viewHome();
}
addEventListener('hashchange', route);
// Préchargement dès que le doigt touche une carte ou un chapitre (~100-300 ms gagnées avant le clic).
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  const [, kind, id, ch] = a.getAttribute('href').split('/');
  if (kind === 'manga' && id) getManga(id).catch(() => {});
  if (kind === 'read' && ch) { getManga(id).catch(() => {}); MangaDex.prefetchChapter(ch, saverOn()); }
}, { passive: true });
document.getElementById('search').onsubmit = (e) => {
  e.preventDefault();
  const q = $q.value.trim();
  location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
  $q.blur();
};
$lang.onchange = () => { lang = $lang.value; store.set('lang', lang); route(); };
route();
