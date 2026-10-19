import { useEffect, useState, useSyncExternalStore } from 'react'
import { cola } from '../lib/colaResultados'

// ¿Hay internet? (según el navegador)
export function useEnLinea() {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const cambiar = () => setEnLinea(navigator.onLine !== false)
    window.addEventListener('online', cambiar)
    window.addEventListener('offline', cambiar)
    return () => {
      window.removeEventListener('online', cambiar)
      window.removeEventListener('offline', cambiar)
    }
  }, [])
  return enLinea
}

// Estado de la cola de resultados sin enviar: { total, conProblema, enEspera, sincronizando }
let ultimo = cola.resumen()
const suscribir = (fn) =>
  cola.suscribir(() => {
    ultimo = cola.resumen()
    fn()
  })
export function useCola() {
  return useSyncExternalStore(suscribir, () => ultimo)
}
