import { esErrorDeRed, mensajeDe } from './errores.js'

// Cola de resultados que todavía no se pudieron enviar (modo sin conexión).
// Cuando falla la red, el resultado se guarda en este dispositivo y se envía solo cuando vuelve internet.
// Cada resultado lleva su propio `id` (uuid): si un envío llegó a la base pero la respuesta se perdió,
// el reintento choca con el mismo id (23505) y se da por enviado: nunca se duplica.
//
// Este módulo no conoce a Supabase (se le pasa la función que envía) para poder probarlo en Node.

const CLAVE = 'tm-cola-resultados'

// Almacenamiento del navegador, tolerante a que no esté disponible (modo privado, pruebas en Node)
function almacenLocal() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // sin acceso al almacenamiento
  }
  return null
}

// item: { id, tabla, creadoPor, fila, encoladoEn, intentos, problema }
//   fila      lo que se inserta en la tabla (con id, organizacion_id, creado_por, creado_en y, si se conoce, torneo_id)
//   problema  null, o el motivo por el que la base lo rechazó (por ejemplo, no había torneo abierto)
export function crearCola(almacen = almacenLocal()) {
  const oyentes = new Set()
  let respaldo = [] // si no hay almacenamiento, la cola vive en memoria
  const estado = { sincronizando: false }

  const leer = () => {
    if (!almacen) return respaldo
    try {
      const lista = JSON.parse(almacen.getItem(CLAVE) ?? '[]')
      return Array.isArray(lista) ? lista : []
    } catch {
      return []
    }
  }
  const avisar = () => oyentes.forEach((f) => f())
  const escribir = (lista) => {
    if (almacen) {
      try {
        almacen.setItem(CLAVE, JSON.stringify(lista))
      } catch {
        respaldo = lista // almacenamiento lleno: al menos se conserva mientras la página siga abierta
      }
    } else {
      respaldo = lista
    }
    avisar()
  }

  return {
    leer,
    agregar(item) {
      escribir([...leer(), { intentos: 0, problema: null, encoladoEn: new Date().toISOString(), ...item }])
    },
    quitar(id) {
      escribir(leer().filter((i) => i.id !== id))
    },
    marcar(id, cambios) {
      escribir(leer().map((i) => (i.id === id ? { ...i, ...cambios } : i)))
    },
    // Reintentar a mano: los rechazados vuelven a intentarse en el próximo envío
    reintentarTodos() {
      escribir(leer().map((i) => ({ ...i, problema: null })))
    },
    // Resumen para mostrar en pantalla
    resumen() {
      const lista = leer()
      const conProblema = lista.filter((i) => i.problema).length
      return { total: lista.length, conProblema, enEspera: lista.length - conProblema, sincronizando: estado.sincronizando }
    },
    marcarSincronizando(valor) {
      estado.sincronizando = valor
      avisar()
    },
    suscribir(fn) {
      oyentes.add(fn)
      return () => oyentes.delete(fn)
    },
    // aviso entre pestañas (otra pestaña cambió la cola)
    avisarCambioExterno: avisar,
  }
}

// Envía de a uno, en orden, lo que quedó pendiente de `usuarioId` (un resultado solo se envía con la sesión de quien lo cargó).
//   enviar(item) → { error }    Resultado: { enviados, sinRed }
//   - enviado o ya existente (23505): se saca de la cola
//   - sin red: se corta y se vuelve a intentar más tarde (el resto sigue esperando)
//   - rechazado por la base (permiso, sin torneo abierto, datos inválidos…): queda marcado con su motivo
export async function enviarPendientes(cola, enviar, usuarioId, { incluirRechazados = false } = {}) {
  let enviados = 0
  for (const item of cola.leer()) {
    if (item.creadoPor !== usuarioId) continue
    if (item.problema && !incluirRechazados) continue
    let respuesta
    try {
      respuesta = await enviar(item)
    } catch (e) {
      respuesta = { error: e }
    }
    const error = respuesta?.error
    if (!error || error.code === '23505') {
      cola.quitar(item.id)
      enviados++
    } else if (esErrorDeRed(error)) {
      return { enviados, sinRed: true }
    } else {
      cola.marcar(item.id, { problema: mensajeDe(error), intentos: (item.intentos ?? 0) + 1 })
    }
  }
  return { enviados, sinRed: false }
}

// Cola de la aplicación (usa el almacenamiento del navegador)
export const cola = crearCola()

// Si otra pestaña cambia la cola, esta se entera
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE) cola.avisarCambioExterno()
  })
}
