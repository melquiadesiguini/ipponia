import { createClient } from '@supabase/supabase-js'
import { esErrorDeRed } from './errores'

// Conexión con Supabase (base de datos y usuarios).
// La URL y la clave "anon" (pública) se leen de variables de entorno de Vite
// (archivo .env.local, que no se sube a git; ver .env.example).
// La clave anon es pública por diseño: lo que protege los datos son las reglas de
// seguridad por fila (RLS) del esquema. NUNCA poner acá la clave "service_role".
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && anonKey)

// Sin configuración la app sigue funcionando como hasta ahora (solo en el navegador)
export const supabase = supabaseConfigurado ? createClient(url, anonKey) : null

// Sesión que Supabase dejó guardada en este dispositivo (sirve para seguir trabajando sin internet)
export function sesionGuardada() {
  try {
    const ref = new URL(url).hostname.split('.')[0]
    const sesion = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`))
    return sesion?.user ? sesion : null
  } catch {
    return null
  }
}

// Con el token vencido y sin internet, Supabase no puede renovarlo y devuelve "sin sesión" aunque el
// usuario siga ingresado. En ese caso (y solo en ese caso) se usa la sesión guardada: cuando vuelve
// la conexión Supabase renueva el token solo.
export function conRespaldoDeSesion(sesion, sinRed) {
  return sesion ?? (sinRed ? sesionGuardada() : null)
}

// Sesión actual, con el respaldo de arriba
export async function obtenerSesion() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  return conRespaldoDeSesion(data.session, navigator.onLine === false || esErrorDeRed(error))
}
