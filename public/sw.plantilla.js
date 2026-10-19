// Service worker de Ipponia: deja la app guardada en el dispositivo para que abra sin internet.
// Este archivo es una plantilla: al compilar, vite.config.js genera sw.js con la lista de archivos de la versión.
//   - Páginas (navegación): primero la red; sin conexión, se entrega la app guardada.
//   - Archivos de la app (JS, CSS, imágenes): primero lo guardado.
//   - Todo lo que no es de este sitio (Supabase, tipografías) no se toca: lo resuelve la red.
//   - version.json y sw.js siempre van a la red (así se detectan las versiones nuevas).
const CACHE = '__CACHE__'
const BASE = '__BASE__'
const ARCHIVOS = '__ARCHIVOS__' // se reemplaza por la lista real al compilar

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ARCHIVOS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith('ipponia-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return

  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido).catch(() => caches.match(BASE + 'index.html').then((r) => r ?? caches.match(BASE)))
    )
    return
  }

  evento.respondWith(
    caches.match(pedido).then(
      (guardado) =>
        guardado ??
        fetch(pedido).then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone()
            caches.open(CACHE).then((cache) => cache.put(pedido, copia))
          }
          return respuesta
        })
    )
  )
})
