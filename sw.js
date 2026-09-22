/* 订单追踪工作台 Service Worker
 * - 仅缓存应用外壳，使安装的 PWA 可离线启动。
 * - CACHE_VERSION 由 deploy.mjs 在每次发布时自动 bump，新版本原子替换旧缓存（缓存破坏）。
 * - S3 同步流量：放行，永远走网络（不缓存远端快照/附件），保证云端数据实时。
 */
const CACHE_VERSION = 'v0.28';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL).catch(() => {/* 缺失资源降级，不阻塞安装 */});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => n !== CACHE_VERSION ? caches.delete(n) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 1) 跨域 S3 同步流量：永远走网络，不缓存
  if (url.host !== self.location.host) return;
  // 2) 同域 GET 静态资源：cache-first + 后台 stale-while-revalidate
  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((resp) => {
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })());
  }
});
