// Çalışma Masası — çevrimdışı çalışma. Derlemede üretilir (vite.config.ts → sw eklentisi).
// Yalnızca kendi dosyalarımızı önbelleğe alır; AI ve model indirme istekleri (başka alan adları) hiç ele alınmaz.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `cm-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cm-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Yeni sürüm hazır olunca uygulama sorar; kullanıcı "Yenile" deyince devreye girer (okuma yarıda kesilmez).
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Sayfa: önce ağ, çevrimdışıysa önbellekteki uygulama.
    e.respondWith(fetch(req).catch(() => caches.match("./index.html", { ignoreSearch: true }).then((r) => r || caches.match("./"))));
    return;
  }
  // Adları içerik özetli dosyalar ve OCR verisi değişmez: önce önbellek; ilk kez gerekenler kullanılınca saklanır.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.includes("/assets/") || url.pathname.includes("/ocr/"))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
