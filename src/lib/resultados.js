import { supabase, obtenerSesion } from './supabase'
import { readArea } from '../hooks/useArea'
import { numeroONull } from './jurado'
import { esErrorDeRed, mensajeDe } from './errores'
import { filaJurado, filaKumite } from './filasResultados'
import { cola, enviarPendientes } from './colaResultados'
import { leerDatosCuenta, leerTorneoAbierto } from './datosOffline'

// Los resultados se guardan en dos tablas según su estructura (ver la migración 20261015120000):
//   resultados_jurado  Kata, Kobudo y Destreza: un juez por columna
//   resultados_kumite  Kumite: marcador, faltas y ganador
// Las pantallas siguen entregando un "payload" con los datos del resultado; acá se reparte en columnas.

// Guarda un resultado (Kata, Kobudo, Destreza o Kumite) en la base de datos, en la
// organización del usuario. Devuelve { ok: true } o { ok: false, motivo, error }.
// motivo: 'sin-configurar' | 'sin-sesion' | 'sin-organizacion' | 'sin-conexion' | 'error'
// Sin conexión el resultado no se pierde: queda en una cola en este dispositivo (`pendiente: true`)
// y se envía solo cuando vuelve internet (ver sincronizarPendientes).
export async function guardarResultado({ modulo, payload }) {
  if (!supabase) return { ok: false, motivo: 'sin-configurar' }

  const sesion = await obtenerSesion()
  if (!sesion) return { ok: false, motivo: 'sin-sesion' }
  const userId = sesion.user.id

  // La organización se conoce por la copia de la cuenta; si no está, se pregunta a la base
  let orgId = leerDatosCuenta(userId)?.organizacion?.id ?? null
  if (!orgId) {
    const { data, error } = await supabase.rpc('mi_organizacion')
    if (esErrorDeRed(error)) return { ok: false, motivo: 'sin-conexion', error }
    if (error || !data) return { ok: false, motivo: 'sin-organizacion', error }
    orgId = data
  }

  const area = numeroONull(readArea())
  const esKumite = modulo === 'kumite'
  const tabla = esKumite ? 'resultados_kumite' : 'resultados_jurado'
  // El id se crea acá: si el envío se repite (por ejemplo, se cortó la respuesta) no se duplica
  const fila = {
    id: crypto.randomUUID(),
    organizacion_id: orgId,
    creado_por: userId,
    ...(esKumite ? filaKumite(payload, area) : filaJurado(modulo, payload, area)),
  }

  const { error } = await supabase.from(tabla).insert(fila)
  if (!error) return { ok: true }
  if (!esErrorDeRed(error)) return { ok: false, motivo: 'error', error }

  // Sin conexión: se guarda en la cola con la hora real del resultado y el torneo que estaba abierto
  const torneo = leerTorneoAbierto(orgId)
  cola.agregar({
    id: fila.id,
    tabla,
    creadoPor: userId,
    fila: { ...fila, creado_en: payload.guardadoEn ?? new Date().toISOString(), ...(torneo?.id ? { torneo_id: torneo.id } : {}) },
  })
  return { ok: false, motivo: 'sin-conexion', pendiente: true, error }
}

// Envía lo que quedó en la cola sin conexión. Se llama al volver internet, al abrir la app y cada tanto.
// `incluirRechazados`: también reintenta los que la base rechazó (por ejemplo, ahora sí hay un torneo abierto).
// Solo hay un envío a la vez. Devuelve { enviados, sinRed }.
let envioEnCurso = null
export function sincronizarPendientes({ incluirRechazados = false } = {}) {
  if (envioEnCurso) return envioEnCurso
  envioEnCurso = (async () => {
    if (!supabase || cola.resumen().total === 0) return { enviados: 0, sinRed: false }
    const sesion = await obtenerSesion()
    if (!sesion) return { enviados: 0, sinRed: false }
    cola.marcarSincronizando(true)
    try {
      return await enviarPendientes(cola, (item) => supabase.from(item.tabla).insert(item.fila), sesion.user.id, { incluirRechazados })
    } finally {
      cola.marcarSincronizando(false)
    }
  })().finally(() => {
    envioEnCurso = null
  })
  return envioEnCurso
}

// Resultados de la organización del usuario (las dos tablas juntas), del más reciente al más antiguo.
// Cada fila trae `tabla`: 'jurado' o 'kumite'.
export async function listarResultados(limite = 200) {
  if (!supabase) return { ok: false, resultados: [] }
  const pedir = (tabla) => supabase.from(tabla).select('*').order('creado_en', { ascending: false }).limit(limite)
  const [jurado, kumite] = await Promise.all([pedir('resultados_jurado'), pedir('resultados_kumite')])
  if (jurado.error || kumite.error) return { ok: false, resultados: [], error: jurado.error || kumite.error }

  const resultados = [
    ...jurado.data.map((r) => ({ ...r, tabla: 'jurado' })),
    ...kumite.data.map((r) => ({ ...r, tabla: 'kumite' })),
  ]
    .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
    .slice(0, limite)
  return { ok: true, resultados }
}

const TABLAS = { jurado: 'resultados_jurado', kumite: 'resultados_kumite' }

// Corrige un resultado ya guardado (solo con el permiso editar_historial; la base lo exige y deja anotado quién y cuándo).
// `tabla`: 'jurado' | 'kumite'. Devuelve { ok: true } o { ok: false, mensaje }.
export async function actualizarResultado(tabla, id, cambios) {
  if (!supabase) return { ok: false, mensaje: 'La base de datos no está configurada.' }
  const { data, error } = await supabase.from(TABLAS[tabla]).update(cambios).eq('id', id).select('id')
  if (error) return { ok: false, mensaje: mensajeDe(error) }
  // sin permiso la base no da error: simplemente no encuentra filas para cambiar
  return data.length ? { ok: true } : { ok: false, mensaje: 'No se pudo guardar el cambio: no tenés permiso para corregir el historial.' }
}

export async function borrarResultado(tabla, id) {
  if (!supabase) return { ok: false, mensaje: 'La base de datos no está configurada.' }
  const { data, error } = await supabase.from(TABLAS[tabla]).delete().eq('id', id).select('id')
  if (error) return { ok: false, mensaje: mensajeDe(error) }
  return data.length ? { ok: true } : { ok: false, mensaje: 'No se pudo borrar: no tenés permiso para corregir el historial.' }
}

// Texto corto para avisar al usuario cómo terminó el guardado en la nube
export function mensajeGuardado(r) {
  if (r.ok) return '☁️ Guardado también en la nube.'
  if (r.pendiente) return '📴 Sin conexión: quedó guardado en este dispositivo y se enviará solo cuando vuelva internet.'
  if (r.motivo === 'sin-conexion') return 'Sin conexión: no se pudo guardar. Revisá tu conexión a internet.'
  if (r.motivo === 'sin-sesion') return 'Guardado solo en este navegador (iniciá sesión para guardarlo en la nube).'
  if (r.motivo === 'sin-configurar') return 'Guardado solo en este navegador.'
  return 'No se pudo guardar en la nube; quedó solo en este navegador.'
}
