// オフライン対応用の Service Worker。
// 方針: キャッシュがあればすぐに返し、裏でネットワークから取り直してキャッシュを更新する(stale-while-revalidate)。
// そのため、デプロイした変更は「次にアプリを開いたとき」に反映される。
// ファイル構成を変えたら PRECACHE を直し、VERSION を上げること。
const VERSION = 'v4';
const CACHE = `clf-quest-${VERSION}`;
const PRECACHE = [
  './',
  'index.html',
  'app.js',
  'manifest.json',
  'data/core.js',
  'data/q1-concepts.js',
  'data/q2-security.js',
  'data/q3-technology.js',
  'data/q4-billing.js',
  'data/cards.js',
  'data/terms.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];
// Google Fonts もキャッシュしておけば、オフラインでも同じ見た目で表示できる
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('clf-quest-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ナビゲーション(アプリの起動)は、クエリ付きでも index.html のキャッシュを使う
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    if (req.mode !== 'navigate') return Response.error();
    return new Response('オフラインのため読み込めませんでした。電波のある場所で一度開いてください。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
