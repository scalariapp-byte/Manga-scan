// Test de fumée hors-ligne : simule l'API MangaDex et vérifie le serveur de bout en bout.
const http = require('http');
const assert = require('assert');

const MID = '11111111-1111-1111-1111-111111111111';
const CH = (n) => `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`;
// PNG 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const manga = {
  id: MID, type: 'manga',
  attributes: { title: { en: 'Test Manga' }, altTitles: [{ fr: 'Manga de test' }], description: { fr: 'Une description.' }, status: 'ongoing', year: 2020, tags: [{ attributes: { name: { en: 'Action' } } }], availableTranslatedLanguages: ['fr'] },
  relationships: [{ type: 'cover_art', attributes: { fileName: 'cover.jpg' } }, { type: 'author', attributes: { name: 'Auteur' } }],
};

function startMock() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/manga') return json({ total: 1, data: [manga] });
      if (u.pathname === `/manga/${MID}`) return json({ data: manga });
      if (u.pathname === `/manga/${MID}/feed`) return json({ total: 4, data: [
        { id: CH(2), attributes: { chapter: '2', pages: 2 }, relationships: [] },
        { id: CH(1), attributes: { chapter: '1', pages: 2 }, relationships: [{ type: 'scanlation_group', attributes: { name: 'Team' } }] },
        { id: CH(9), attributes: { chapter: '1', pages: 2 }, relationships: [] }, // doublon
        { id: CH(3), attributes: { chapter: '3', pages: 0, externalUrl: 'https://ext' }, relationships: [] }, // externe
      ] });
      if (u.pathname.startsWith('/at-home/server/')) return json({ baseUrl: `http://${req.headers.host}`, chapter: { hash: 'h', data: ['a.png', 'b.png'], dataSaver: ['a.jpg', 'b.jpg'] } });
      if (u.pathname.startsWith('/data/') || u.pathname.startsWith('/covers/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      res.writeHead(404); res.end();
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const mock = await startMock();
  const host = `127.0.0.1:${mock.address().port}`;
  process.env.MANGADEX_API = `http://${host}`;
  process.env.MANGADEX_COVERS = `http://${host}`;
  process.env.EXTRA_IMAGE_HOSTS = host;
  const server = require('../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };

  let r = await get('/api/manga?lang=fr');
  assert.equal(r.status, 200);
  assert.equal(r.body.items[0].title, 'Manga de test');
  assert.ok(r.body.items[0].cover.startsWith('/img?u='));

  r = await get(`/api/manga/${MID}?lang=fr`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chapters.map((c) => c.chapter), ['1', '2'], 'tri, dédoublonnage, exclusion des chapitres externes');

  r = await get(`/api/chapter/${CH(1)}/pages`);
  assert.equal(r.body.pages.length, 2);
  const img = await fetch(base + r.body.pages[0]);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  r = await get('/img?u=' + encodeURIComponent('http://evil.example.com/x.png'));
  assert.equal(r.status, 403, 'proxy limité aux hôtes MangaDex');

  r = await get('/../server.js');
  assert.ok(!String(r.body).includes('MANGADEX_API'), 'pas de traversée de répertoire');

  r = await get('/');
  assert.ok(r.body.includes('Manga-scan'));

  console.log('OK — tous les tests passent');
  server.close(); mock.close();
})().catch((e) => { console.error(e); process.exit(1); });
