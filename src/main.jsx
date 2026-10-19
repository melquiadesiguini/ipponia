import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Si el navegador abrió una versión vieja guardada en caché, la recarga una vez
// con la versión publicada (evita tener que agregar ?v=N a mano en la URL).
async function buscarVersionNueva() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
    const { id } = await res.json()
    if (!id || id === __BUILD_ID__) return
    if (sessionStorage.getItem('tm-recarga') === id) return // ya se intentó: sin bucles
    sessionStorage.setItem('tm-recarga', id)
    const url = new URL(location.href)
    url.searchParams.set('v', id)
    location.replace(url.toString())
  } catch {
    // sin conexión o sin version.json: se sigue con la versión actual
  }
}

if (import.meta.env.PROD) buscarVersionNueva()

// Modo sin conexión: el service worker deja la app guardada en el dispositivo para abrirla sin internet
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
