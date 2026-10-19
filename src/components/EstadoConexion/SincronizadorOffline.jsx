import { useEffect } from 'react'
import useAuth from '../../hooks/useAuth'
import { sincronizarPendientes } from '../../lib/resultados'

const CADA_MS = 20 * 1000

// No dibuja nada: envía los resultados que quedaron en la cola sin conexión.
// Intenta al abrir la app, al iniciar sesión, cuando el navegador avisa que volvió internet y cada 20 segundos
// (los que la base rechazó no se reintentan solos: hay un botón en el aviso del encabezado).
function SincronizadorOffline() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return undefined
    const enviar = () => {
      if (navigator.onLine !== false) sincronizarPendientes()
    }
    enviar()
    window.addEventListener('online', enviar)
    const reloj = setInterval(enviar, CADA_MS)
    return () => {
      window.removeEventListener('online', enviar)
      clearInterval(reloj)
    }
  }, [userId])

  return null
}

export default SincronizadorOffline
