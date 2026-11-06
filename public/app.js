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
const STATUS = { ongoing: 'En cours', completed: 'Terminé', hiatus: 'En pause', cancelled: 'Annulé' };
const chLabel = (c) => (c.chapter ? `Chapitre ${c.chapter}` : 'Oneshot') + (c.title ? ` — ${c.title}` : '');
const coverImg = (src) => (src ? `<img loading="lazy" src="${esc(src)}" alt="" onload="this.classList.add('ok')">` : '');
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
  const key = id + ':' + lang;
  if (!mangaCache.has(key)) mangaCache.set(key, MangaDex.getManga(id, lang).catch((e) => { mangaCache.delete(key); throw e; }));
  return mangaCache.get(key);
}

async function viewManga(id) {
  $app.innerHTML = '<div class="grid" style="margin-top:20px">' + skeletons(6) + '</div>';
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
      <div class="hero">
        ${m.cover ? `<div class="bg" style="background-image:url('${esc(m.cover)}')"></div>` : ''}
        <div class="detail">
          <div>${m.cover ? `<img class="cover" src="${esc(m.cover)}" alt="">` : ''}</div>
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
          ${m.description ? `<div class="desc" id="desc">${esc(m.description)}</div>` : ''}
      <div class="chhead"><h2>${m.chapters.length} chapitres <span class="meta">(${esc(lang.toUpperCase())})</span></h2>
        <button class="btn" id="order">${desc ? '↓ Récents' : '↑ Anciens'}</button></div>
      ${m.chapters.length ? `<ul class="chapters">${list.map((c) => `
        <li><a href="#/read/${id}/${c.id}" class="${read[c.id] ? 'read' : ''}">
          <span class="name">${esc(chLabel(c))}</span>
          <small>${c.volume ? `Vol. ${esc(c.volume)}<br>` : ''}${c.publishedAt ? new Date(c.publishedAt).toLocaleDateString('fr-FR') : ''}</small>
        </a></li>`).join('')}</ul>`
      : `<div class="err"><b>Aucun chapitre lisible en ${esc(lang.toUpperCase())}</b>Les chapitres de ce manga sont peut-être publiés par un éditeur officiel (non lisibles ici). Essayez une autre langue en haut à droite.</div>`}`;
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
  $app.innerHTML = '<p class="msg" style="padding-top:40vh">Chargement du chapitre…</p>';
  let m, pages;
  try {
    [m, pages] = await Promise.all([getManga(mangaId), MangaDex.getPages(chapterId, store.get('saver', false))]);
  } catch (e) { $app.innerHTML = errorBox(e) + '<p class="msg"><a class="btn" href="#/manga/' + esc(mangaId) + '">Retour</a></p>'; return; }
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
      <div class="ttl"><b>${esc(m.title)}</b>
      <select id="chsel">${m.chapters.map((c) => `<option value="${c.id}" ${c.id === chapterId ? 'selected' : ''}>${esc(chLabel(c))}</option>`).join('')}</select></div>
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
      document.querySelector('.pages').onclick = () => bar.classList.toggle('hide');
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
