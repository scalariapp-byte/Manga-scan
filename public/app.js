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
async function api(path) {
  const r = await fetch(path);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}
const chLabel = (c) => (c.chapter ? `Chapitre ${c.chapter}` : 'Oneshot') + (c.title ? ` — ${c.title}` : '');
const card = (m, sub = '') => `
  <a class="card" href="#/manga/${m.id}">
    <div class="cover">${m.cover ? `<img loading="lazy" src="${esc(m.cover)}" alt="">` : ''}</div>
    <div class="t">${esc(m.title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}
  </a>`;
const errorBox = (e) => `<p class="msg">⚠️ ${esc(e.message)}<br><button class="btn" onclick="route()">Réessayer</button></p>`;

// ---------- Accueil / recherche ----------
let listState = { sort: 'popular', q: '', offset: 0 };

async function viewHome(q = '') {
  document.title = 'Manga-scan';
  listState = { sort: listState.sort, q, offset: 0 };
  const h = Object.values(history()).sort((a, b) => b.at - a.at).slice(0, 20);
  const f = Object.values(favs());
  $app.innerHTML = `
    ${!q && h.length ? `<h2>Continuer la lecture</h2><div class="row">${h.map((x) => `
      <a class="card" href="#/read/${x.id}/${x.chapterId}">
        <div class="cover">${x.cover ? `<img loading="lazy" src="${esc(x.cover)}" alt="">` : ''}</div>
        <div class="t">${esc(x.title)}</div><div class="s">Ch. ${esc(x.chapter ?? '?')}</div></a>`).join('')}</div>` : ''}
    ${!q && f.length ? `<h2>Favoris</h2><div class="row">${f.map((m) => card(m)).join('')}</div>` : ''}
    <h2>${q ? `Résultats pour « ${esc(q)} »` : 'Découvrir'}</h2>
    ${q ? '' : `<div class="tabs">
      ${[['popular', 'Populaires'], ['latest', 'Mis à jour'], ['rating', 'Mieux notés']].map(([k, l]) =>
        `<button class="tab ${listState.sort === k ? 'active' : ''}" data-sort="${k}">${l}</button>`).join('')}
    </div><br>`}
    <div class="grid" id="grid"></div>
    <div class="more" id="more"></div>`;
  $app.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => { listState.sort = b.dataset.sort; viewHome(); });
  loadMore();
}

async function loadMore() {
  const $grid = document.getElementById('grid'), $more = document.getElementById('more');
  if (!$grid) return;
  $more.innerHTML = '<p class="msg">Chargement…</p>';
  try {
    const p = new URLSearchParams({ lang, sort: listState.sort, offset: listState.offset });
    if (listState.q) p.set('q', listState.q);
    const data = await api('/api/manga?' + p);
    if (!document.getElementById('grid')) return; // l'utilisateur a changé de page
    $grid.insertAdjacentHTML('beforeend', data.items.map((m) => card(m, m.year || '')).join(''));
    listState.offset += data.items.length;
    if (!listState.offset) $more.innerHTML = '<p class="msg">Aucun manga trouvé dans cette langue.</p>';
    else if (listState.offset < data.total && data.items.length) {
      $more.innerHTML = '<button class="btn">Voir plus</button>';
      $more.firstChild.onclick = loadMore;
    } else $more.innerHTML = '';
  } catch (e) { $more.innerHTML = errorBox(e); }
}

// ---------- Fiche manga ----------
const mangaCache = new Map();
async function getManga(id) {
  const key = id + ':' + lang;
  if (!mangaCache.has(key)) mangaCache.set(key, api(`/api/manga/${id}?lang=${lang}`).catch((e) => { mangaCache.delete(key); throw e; }));
  return mangaCache.get(key);
}

async function viewManga(id) {
  $app.innerHTML = '<p class="msg">Chargement…</p>';
  let m;
  try { m = await getManga(id); } catch (e) { $app.innerHTML = errorBox(e); return; }
  document.title = m.title + ' — Manga-scan';
  const read = readSet();
  const hist = history()[id];
  const first = m.chapters[0];
  let desc = true; // ordre décroissant par défaut
  const render = () => {
    const isFav = !!favs()[id];
    const list = desc ? [...m.chapters].reverse() : m.chapters;
    $app.innerHTML = `
      <div class="detail">
        <div>${m.cover ? `<img class="cover" src="${esc(m.cover)}" alt="">` : ''}</div>
        <div>
          <h1>${esc(m.title)}</h1>
          <div class="meta">${[m.author, m.year, m.status].filter(Boolean).map(esc).join(' · ')} · ${m.chapters.length} chapitres (${esc(lang.toUpperCase())})</div>
          <div class="tags">${m.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
          <div class="actions">
            ${hist ? `<a class="btn primary" href="#/read/${id}/${hist.chapterId}">Reprendre ch. ${esc(hist.chapter ?? '?')}</a>` : ''}
            ${first ? `<a class="btn ${hist ? '' : 'primary'}" href="#/read/${id}/${first.id}">Commencer</a>` : ''}
            <button class="btn" id="fav">${isFav ? '★ Favori' : '☆ Ajouter aux favoris'}</button>
            <button class="btn" id="order">${desc ? 'Plus récents ↓' : 'Plus anciens ↓'}</button>
          </div>
          ${m.description ? `<div class="desc" id="desc">${esc(m.description)}</div>` : ''}
        </div>
      </div>
      <h2>Chapitres</h2>
      ${m.chapters.length ? `<ul class="chapters">${list.map((c) => `
        <li><a href="#/read/${id}/${c.id}" class="${read[c.id] ? 'read' : ''}">
          <span>${c.volume ? `Vol. ${esc(c.volume)} · ` : ''}${esc(chLabel(c))}</span>
          <small>${esc(c.group || '')} ${c.publishedAt ? new Date(c.publishedAt).toLocaleDateString('fr-FR') : ''}</small>
        </a></li>`).join('')}</ul>`
      : `<p class="msg">Aucun chapitre lisible dans cette langue. Essayez une autre langue en haut à droite.</p>`}`;
    document.getElementById('fav').onclick = () => { toggleFav(m); render(); };
    document.getElementById('order').onclick = () => { desc = !desc; render(); };
    const d = document.getElementById('desc'); if (d) d.onclick = () => d.classList.toggle('open');
  };
  render();
}

// ---------- Lecteur ----------
let readerCleanup = null;
async function viewReader(mangaId, chapterId) {
  document.body.classList.add('reading');
  $app.innerHTML = '<p class="msg">Chargement du chapitre…</p>';
  let m, pages;
  try {
    [m, { pages }] = await Promise.all([getManga(mangaId), api(`/api/chapter/${chapterId}/pages?saver=${store.get('saver', false) ? 1 : 0}`)]);
  } catch (e) { $app.innerHTML = errorBox(e) + '<p class="msg"><a class="btn" href="#/">Accueil</a></p>'; return; }
  const idx = m.chapters.findIndex((c) => c.id === chapterId);
  const ch = m.chapters[idx] || { id: chapterId, chapter: null };
  const prev = m.chapters[idx - 1], next = m.chapters[idx + 1];
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
      <div class="ttl">${esc(m.title)}</div>
      <select id="chsel">${m.chapters.map((c) => `<option value="${c.id}" ${c.id === chapterId ? 'selected' : ''}>${esc(chLabel(c))}</option>`).join('')}</select>
      <button class="btn" id="mode" title="Mode de lecture">${mode === 'vertical' ? '⇕' : '⇔'}</button>
    </div>${body}`;
  const endnav = `<div class="endnav">
      <button class="btn" id="prevch" ${prev ? '' : 'disabled'}>← Précédent</button>
      <button class="btn primary" id="nextch" ${next ? '' : 'disabled'}>${next ? 'Chapitre suivant →' : 'Dernier chapitre'}</button></div>`;

  let cleanups = [];
  const render = () => {
    cleanups.forEach((f) => f()); cleanups = [];
    if (mode === 'vertical') {
      $app.innerHTML = shell(`<div class="pages">${pages.map((src, i) => `<img data-i="${i}" src="${esc(src)}" loading="${i < 3 ? 'eager' : 'lazy'}" alt="Page ${i + 1}">`).join('')}</div>${endnav}<div class="counter" id="counter"></div>`);
      const imgs = [...$app.querySelectorAll('.pages img')];
      imgs.forEach((im) => { im.onload = () => im.classList.add('loaded'); im.onerror = () => retryImg(im); });
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
      cleanups.push(() => removeEventListener('scroll', onScroll));
    } else {
      let page = startPage;
      $app.innerHTML = shell(`<div class="paged" id="paged"><img id="pimg" alt=""></div><div class="counter" id="counter"></div>`);
      const img = document.getElementById('pimg'), counter = document.getElementById('counter');
      const show = () => {
        img.src = pages[page]; img.onerror = () => retryImg(img);
        counter.textContent = `${page + 1} / ${pages.length}`; save(page);
        [1, 2].forEach((k) => { if (pages[page + k]) new Image().src = pages[page + k]; }); // préchargement
      };
      const step = (d) => {
        const p = page + d;
        if (p < 0) return go(prev);
        if (p >= pages.length) return go(next);
        page = p; show();
      };
      document.getElementById('paged').onclick = (e) => step(e.clientX < innerWidth / 3 ? -1 : 1);
      const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); } if (e.key === 'ArrowLeft') step(-1); };
      addEventListener('keydown', onKey);
      cleanups.push(() => removeEventListener('keydown', onKey));
      show();
    }
    document.getElementById('chsel').onchange = (e) => go({ id: e.target.value });
    document.getElementById('mode').onclick = () => { mode = mode === 'vertical' ? 'paged' : 'vertical'; store.set('mode', mode); render(); };
    const pv = document.getElementById('prevch'), nx = document.getElementById('nextch');
    if (pv) pv.onclick = () => go(prev);
    if (nx) nx.onclick = () => go(next);
  };
  render();
  readerCleanup = () => cleanups.forEach((f) => f());
}

// Les serveurs d'images MangaDex@Home tombent parfois : on réessaie une fois avec un délai.
function retryImg(img) {
  if (img.dataset.retry) return;
  img.dataset.retry = '1';
  setTimeout(() => { img.src = img.src + (img.src.includes('?') ? '&' : '?') + 'r=1'; }, 1500);
}

// ---------- Routage ----------
function route() {
  if (readerCleanup) { readerCleanup(); readerCleanup = null; }
  document.body.classList.remove('reading');
  scrollTo(0, 0);
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'manga' && parts[1]) return viewManga(parts[1]);
  if (parts[0] === 'read' && parts[2]) return viewReader(parts[1], parts[2]);
  if (parts[0] === 'search') { $q.value = parts[1] || ''; return viewHome(parts[1] || ''); }
  $q.value = '';
  return viewHome();
}
addEventListener('hashchange', route);
document.getElementById('search').onsubmit = (e) => {
  e.preventDefault();
  const q = $q.value.trim();
  location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
  $q.blur();
};
$lang.onchange = () => { lang = $lang.value; store.set('lang', lang); route(); };
route();
