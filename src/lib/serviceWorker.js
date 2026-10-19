// Registro del service worker (ver public/sw.plantilla.js) y aviso de versión nueva.
// Una versión nueva se descarga sola, pero no se activa en medio de una sesión: queda esperando
// hasta que el usuario toca "Actualizar" (así no se corta un combate ni se rompe la pantalla abierta).

const oyentes = new Set()
let hayNueva = false
let registro = null
let pidioActualizar = false

const avisar = () => oyentes.forEach((f) => f())
const marcarNueva = () => {
  hayNueva = true
  avisar()
}

export const suscribirActualizacion = (fn) => {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}
export const hayVersionNueva = () => hayNueva

// El usuario eligió actualizar: la versión nueva toma el control y la página se recarga una vez
export function aplicarActualizacion() {
  pidioActualizar = true
  if (registro?.waiting) registro.waiting.postMessage('saltear-espera')
  else location.reload()
}

const CADA_MS = 30 * 60 * 1000

export function iniciarServiceWorker(url) {
  if (!('serviceWorker' in navigator)) return

  // la recarga solo ocurre si el usuario la pidió (la primera instalación también cambia de "controlador")
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pidioActualizar) location.reload()
  })

  navigator.serviceWorker
    .register(url)
    .then((reg) => {
      registro = reg
      if (reg.waiting && navigator.serviceWorker.controller) marcarNueva()
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) marcarNueva()
        })
      })
      // busca versiones nuevas cada 30 minutos y al volver a la app (una tablet puede estar abierta todo el día)
      const buscar = () => reg.update().catch(() => {})
      setInterval(buscar, CADA_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') buscar()
      })
    })
    .catch(() => {})
}
