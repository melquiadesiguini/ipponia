// Service worker de Ipponia: deja la app guardada en el dispositivo para que abra sin internet.
// Este archivo es una plantilla: al compilar, vite.config.js genera sw.js con la lista de archivos de la versión.
//   - Páginas (navegación): primero la red; sin conexión, se entrega la app guardada.
//   - Archivos de la app (JS, CSS, imágenes): primero lo guardado.
//   - Todo lo que no es de este sitio (Supabase, tipografías) no se toca: lo resuelve la red.
//   - version.json y sw.js siempre van a la red (así se detectan las versiones nuevas).
const CACHE = 'ipponia-1792436895071'
const BASE = '/ipponia/'
const ARCHIVOS = ["/ipponia/apple-touch-icon.png","/ipponia/assets/foto1-CSRCcFiW.jpg","/ipponia/assets/foto2-B_w2eAgz.jpg","/ipponia/assets/foto3-BBOO328D.jpg","/ipponia/assets/foto4-D7enp21X.jpg","/ipponia/assets/foto5-bPOa6G8D.jpeg","/ipponia/assets/foto6-BJ2J6O7q.jpg","/ipponia/assets/index-BfqNsj3s.js","/ipponia/assets/index-DTsdV5-U.css","/ipponia/assets/ipponia-logo-DM6M5BcB.png","/ipponia/assets/ipponia-logo-oscuro-C_36sNtq.png","/ipponia/assets/ipponia-marca-BGChaFNa.png","/ipponia/assets/ipponia-marca-oscuro-bI2vLcqO.png","/ipponia/favicon-32.png","/ipponia/favicon.png","/ipponia/favicon.svg","/ipponia/icon-192.png","/ipponia/icon-512.png","/ipponia/icons.svg","/ipponia/index.html","/ipponia/manifest.webmanifest","/ipponia/og-image.png"] // se reemplaza por la lista real al compilar

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
