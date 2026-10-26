import { useEffect, useState } from 'react'
import { CLAVE_RANKING, leerRanking } from '../lib/ranking'

const STORAGE_KEY = 'tm-display'

function writeDisplay(payload) {
  try {
    if (payload) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, t: Date.now() }))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // sin acceso a localStorage: la pantalla pública simplemente no se actualiza
  }
}

function readDisplay() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

// Panel de control: publica el resultado mientras el cartel está visible
// y lo retira al cerrarlo (o al salir de la página).
export function usePublishResult(visible, buildPayload) {
  useEffect(() => {
    writeDisplay(visible ? buildPayload() : null)
    return () => writeDisplay(null)
    // buildPayload se evalúa solo cuando el cartel aparece o desaparece
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
}

// Panel de control (Kumite): publica el estado en vivo cada vez que cambia
// y lo retira al salir de la página. Con `habilitado` en false no publica ni
// retira nada (para un tablero independiente que no debe tocar el de otra ventana).
export function usePublishLive(payload, habilitado = true) {
  const json = JSON.stringify(payload)

  useEffect(() => {
    if (habilitado) writeDisplay(JSON.parse(json))
  }, [json, habilitado])

  useEffect(() => {
    if (!habilitado) return undefined
    return () => writeDisplay(null)
  }, [habilitado])
}

// Pantalla pública: usa el mismo tema (claro/oscuro) que el panel de control.
// El tema se guarda en localStorage ('theme'), así que al cambiarlo en el
// panel esta ventana se entera por el evento 'storage'.
export function usePublicTheme() {
  useEffect(() => {
    const aplicar = () => {
      const guardado = localStorage.getItem('theme')
      const oscuro =
        guardado === 'dark' ||
        (guardado !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', oscuro ? 'dark' : 'light')
    }
    const onStorage = (e) => {
      if (e.key === 'theme' || e.key === null) aplicar()
    }
    aplicar()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}

// Pantalla pública: se actualiza cuando el panel de control publica algo.
export function useDisplayState() {
  const [state, setState] = useState(readDisplay)

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY || e.key === null) setState(readDisplay())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return state
}

// Abre la pantalla pública y, si hay un segundo monitor y el navegador lo
// permite, la mueve ahí. La ventana se abre primero (de inmediato, para no
// perder el permiso del clic) y se reubica después.
export async function openPublicDisplay() {
  const url = `${import.meta.env.BASE_URL}pantalla`
  const win = window.open(url, 'tm-display', 'popup=yes,width=1280,height=720')
  if (!win) return

  try {
    if (window.screen.isExtended && window.getScreenDetails) {
      const details = await window.getScreenDetails()
      const current = details.currentScreen
      const other = details.screens.find((s) => s !== current && s.left !== current.left)
      if (other) {
        // Chrome ignora el movimiento mientras la ventana se está creando,
        // por eso se repite unos instantes después
        const place = () => {
          if (win.closed) return
          win.moveTo(other.availLeft, other.availTop)
          win.resizeTo(other.availWidth, other.availHeight)
        }
        place()
        setTimeout(place, 300)
        setTimeout(place, 1000)
      }
    }
  } catch {
    // sin permiso para ver los monitores: queda en la pantalla actual
  }
}

// Pantalla pública: ranking de la ronda en curso (lo anota el panel de control al calcular cada resultado).
// Devuelve null si no hay ranking, si quedó viejo o si todavía no hay ningún puntaje.
export function useRanking() {
  const [ranking, setRanking] = useState(() => leerRanking())

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === CLAVE_RANKING || e.key === null) setRanking(leerRanking())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return ranking
}
