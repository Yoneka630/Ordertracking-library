/* 订单追踪工作台 Service Worker
 * - 缓存应用外壳 + 本地 OCR 运行时，使安装的 PWA 可离线启动、离线识别截图。
 * - CACHE_VERSION 由 deploy.mjs 在每次发布时自动 bump，新版本原子替换旧缓存（缓存破坏）。
 * - S3 同步流量：放行，永远走网络（不缓存远端快照/附件），保证云端数据实时。
 */
const CACHE_VERSION = 'v1.3.17';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];
/* v1.3.14 · 本地 OCR 运行时（约 11MB）。随包预缓存后，PWA 完全离线也能识别截图；
   引擎本身仍由页面懒加载 —— 不点「从图片识别」不会发起任何请求。 */
const OCR_SHELL = [
  './vendor/tesseract.min.js',
  './vendor/worker.min.js',
  './vendor/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract-core-lstm.wasm.js',
  './vendor/chi_sim.traineddata.gz',
  './vendor/eng.traineddata.gz'
];
/* v1.3.17 · 扁平部署（GitHub 网页上传把 6 个文件平铺到仓库根）：同样尽力缓存，
   标准部署下这 6 个请求会 404，被 catch 忽略，不影响安装与在线识别。 */
const OCR_SHELL_FLAT = [
  './tesseract.min.js',
  './worker.min.js',
  './tesseract-core-simd-lstm.wasm.js',
  './tesseract-core-lstm.wasm.js',
  './chi_sim.traineddata.gz',
  './eng.traineddata.gz'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    /* 核心壳成组缓存；OCR 资源逐个尽力缓存，单项缺失不影响其余与安装 */
    await cache.addAll(APP_SHELL).catch(() => {/* 缺失资源降级，不阻塞安装 */});
    await Promise.all(OCR_SHELL.map((u) => cache.add(u).catch(() => {})));
    await Promise.all(OCR_SHELL_FLAT.map((u) => cache.add(u).catch(() => {})));
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
