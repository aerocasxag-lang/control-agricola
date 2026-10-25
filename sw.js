// Service worker: guarda la app en el celular para abrirla sin señal.
const VERSION = "agricola-v2";
const APP = ["./", "index.html", "styles.css", "app.js", "util.js", "manifest.webmanifest", "icon.svg"];
const LIBRERIAS = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
];
const TEJAS = "tejas-v1", MAX_TEJAS = 3000;

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(APP);
    // Con CORS: los módulos de Firebase no funcionan desde una respuesta opaca.
    await Promise.all(LIBRERIAS.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== TEJAS) await caches.delete(k);
    self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firebase (base de datos e inicio de sesión) maneja su propia caché: no se toca.
  if (/googleapis\.com$|firebaseio\.com$|identitytoolkit|securetoken/.test(url.hostname)) return;

  // Tejas satelitales: red primero, guardando lo visitado; sin señal, lo guardado.
  if (url.hostname === "server.arcgisonline.com") {
    e.respondWith((async () => {
      const c = await caches.open(TEJAS);
      try {
        const r = await fetch(req);
        c.put(req, r.clone()).then(() => recortar(c)).catch(() => {});
        return r;
      } catch { return (await c.match(req)) || Response.error(); }
    })());
    return;
  }
  // App y librerías: lo guardado primero, actualizando en segundo plano.
  if (url.origin === location.origin || /gstatic\.com$|cdnjs\.cloudflare\.com$|fonts\.googleapis\.com$/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const guardado = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const red = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => null);
      return guardado || (await red) || (req.mode === "navigate" ? c.match("index.html") : Response.error());
    })());
  }
});

let recortando = false;
async function recortar(c) {
  if (recortando) return; recortando = true;
  try { const k = await c.keys(); if (k.length > MAX_TEJAS) for (const r of k.slice(0, k.length - MAX_TEJAS)) await c.delete(r); }
  finally { recortando = false; }
}
