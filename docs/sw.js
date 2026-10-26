// Service worker de Ipponia: deja la app guardada en el dispositivo para que abra sin internet.
// Este archivo es una plantilla: al compilar, vite.config.js genera sw.js con la lista de archivos de la versión.
//   - Páginas (navegación): primero la red; sin conexión, se entrega la app guardada.
//   - Archivos de la app (JS, CSS, imágenes): primero lo guardado.
//   - Tipografías de Google: se guardan la primera vez que se descargan, para verse igual sin internet.
//   - Todo lo demás que no es de este sitio (Supabase) no se toca: lo resuelve la red.
//   - version.json y sw.js siempre van a la red (así se detectan las versiones nuevas).
//   - Una versión nueva NO reemplaza a la actual en medio de una sesión: espera a que el usuario toque
//     "Actualizar" en el aviso de la app (que manda el mensaje 'saltear-espera'), o a que se cierre la app.
const CACHE = 'ipponia-1793033563259'
const BASE = '/ipponia/'
const ARCHIVOS = ["/ipponia/apple-touch-icon.png","/ipponia/assets/index-BmPZQxrh.js","/ipponia/assets/index-DbSmlzwH.css","/ipponia/assets/ipponia-logo-DM6M5BcB.png","/ipponia/assets/ipponia-logo-oscuro-C_36sNtq.png","/ipponia/assets/ipponia-marca-BGChaFNa.png","/ipponia/assets/ipponia-marca-oscuro-bI2vLcqO.png","/ipponia/favicon-32.png","/ipponia/favicon.png","/ipponia/favicon.svg","/ipponia/icon-192.png","/ipponia/icon-512.png","/ipponia/index.html","/ipponia/manifest.webmanifest","/ipponia/og-image.png"] // se reemplaza por la lista real al compilar
const CACHE_TIPOGRAFIAS = 'tipografias-ipponia' // no empieza con "ipponia-": sobrevive a las versiones
const SITIOS_TIPOGRAFIAS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)))
})

self.addEventListener('message', (evento) => {
  if (evento.data === 'saltear-espera') self.skipWaiting()
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

  if (SITIOS_TIPOGRAFIAS.includes(url.hostname)) {
    evento.respondWith(
      caches.match(pedido).then(
        (guardado) =>
          guardado ??
          fetch(pedido).then((respuesta) => {
            // una hoja de estilos de otro sitio llega "opaca" (sin poder leerla), pero se puede guardar igual
            if (respuesta.ok || respuesta.type === 'opaque') {
              const copia = respuesta.clone()
              caches.open(CACHE_TIPOGRAFIAS).then((cache) => cache.put(pedido, copia))
            }
            return respuesta
          })
      )
    )
    return
  }

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
