// Instalar Ipponia como app (PWA): en Chrome y Edge el navegador avisa con `beforeinstallprompt`;
// en iPhone y iPad no existe ese aviso y hay que explicar el paso a mano.

const oyentes = new Set()
let eventoInstalar = null
let instalada = false

const avisar = () => oyentes.forEach((f) => f())

// ¿iPhone o iPad? (los iPad nuevos se presentan como Mac, pero tienen pantalla táctil)
export function esDispositivoApple(userAgent = '', plataforma = '', puntosTactiles = 0) {
  return /iphone|ipad|ipod/i.test(userAgent) || (plataforma === 'MacIntel' && puntosTactiles > 1)
}

// ¿Ya se está usando como app instalada? (sin la barra del navegador)
export function estaInstalada() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true || window.navigator.standalone === true
}

// Se escucha desde que carga la página: el aviso del navegador puede llegar antes de que se dibuje la pantalla
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // se muestra más tarde, con nuestro propio botón
    eventoInstalar = e
    avisar()
  })
  window.addEventListener('appinstalled', () => {
    instalada = true
    eventoInstalar = null
    avisar()
  })
}

export const suscribirInstalacion = (fn) => {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

// Estado para la pantalla. Se devuelve siempre el mismo objeto mientras no cambie nada.
let foto = null
export function estadoInstalacion() {
  const nuevo = {
    puedeInstalar: eventoInstalar !== null,
    instalada: instalada || estaInstalada(),
    esApple: typeof navigator !== 'undefined' && esDispositivoApple(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  }
  if (foto && foto.puedeInstalar === nuevo.puedeInstalar && foto.instalada === nuevo.instalada && foto.esApple === nuevo.esApple) return foto
  foto = nuevo
  return foto
}

// Abre el cuadro de instalación del navegador
export async function instalarApp() {
  if (!eventoInstalar) return { ok: false }
  eventoInstalar.prompt()
  const { outcome } = await eventoInstalar.userChoice
  eventoInstalar = null
  avisar()
  return { ok: outcome === 'accepted' }
}
