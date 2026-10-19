import { supabase } from './supabase'
import { llamarFuncion } from './funciones'
import { mensajeDe } from './errores'
import { conSufijo, slugDesdeNombre } from './slug'

export const ESTADOS_ORGANIZACION = { prueba: 'En prueba', activa: 'Activa', suspendida: 'Suspendida' }

// Panel del superadmin. Solo datos agregados de cada cliente (cantidad de usuarios y torneos):
// la base no le muestra resultados, jueces ni competidores de las organizaciones.
export async function listarOrganizaciones() {
  const { data, error } = await supabase.rpc('superadmin_resumen')
  return error ? { ok: false, filas: [] } : { ok: true, filas: data }
}

// Alta de un cliente (Edge Function): organización + roles de fábrica + dueño.
// El identificador (slug) se genera del nombre; si ya existe, se prueba con -2, -3… (hasta 6 intentos).
// Devuelve { ok: true, slug } con el identificador que quedó, o { ok: false, mensaje }.
const SLUG_REPETIDO = 'Ya existe una organización con ese identificador.'
export async function crearOrganizacion({ nombre, email_dueno, clave, vence_el }) {
  const base = slugDesdeNombre(nombre)
  if (!base) return { ok: false, mensaje: 'Escribí el nombre de la organización.' }
  let r = { ok: false, mensaje: SLUG_REPETIDO }
  for (let n = 1; n <= 6 && !r.ok && r.mensaje === SLUG_REPETIDO; n++) {
    const slug = conSufijo(base, n)
    r = await llamarFuncion('crear-organizacion', {
      slug,
      nombre: nombre.trim(),
      email_dueno: email_dueno.trim(),
      clave: clave || undefined,
      vence_el: vence_el || undefined,
    })
    if (r.ok) return { ...r, slug }
  }
  return r.mensaje === SLUG_REPETIDO ? { ok: false, mensaje: 'Ya hay organizaciones con un nombre muy parecido. Probá con otro nombre.' } : r
}

export async function actualizarOrganizacion(id, { nombre, plan, estado, vence_el, notas }) {
  const { error } = await supabase.rpc('superadmin_actualizar_organizacion', {
    p_organizacion: id,
    p_nombre: nombre,
    p_plan: plan,
    p_estado: estado,
    p_vence_el: vence_el || null,
    p_notas: notas || null,
  })
  return error ? { ok: false, mensaje: mensajeDe(error) } : { ok: true }
}

// Dirección donde entran los usuarios de una organización
export const urlIngreso = (slug) => `${window.location.origin}${import.meta.env.BASE_URL}${slug}/ingresar`
