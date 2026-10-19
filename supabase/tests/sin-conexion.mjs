// Pruebas del modo sin conexión (no necesitan base de datos ni navegador):
//   - la cola de resultados pendientes y su envío
//   - el service worker que deja la app guardada para abrirla sin internet
//
//   npm run test:offline
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { crearCola, enviarPendientes } from '../../src/lib/colaResultados.js'
import { esErrorDeRed, mensajeDe } from '../../src/lib/errores.js'

let ok = 0
let fallos = 0
function prueba(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre} ${detalle}`)
  }
}

// Almacenamiento falso con la misma interfaz que localStorage
const almacenFalso = () => {
  const datos = new Map()
  return { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, String(v)) }
}
const item = (n, extra = {}) => ({ id: `id-${n}`, tabla: 'resultados_jurado', creadoPor: 'u1', fila: { id: `id-${n}` }, ...extra })
const errRed = { message: 'TypeError: Failed to fetch', code: '' }

// ---------------------------------------------------------------- 1) Qué es un error de red
console.log('\n1) Distinguir "sin internet" de una respuesta de la base')
prueba('"Failed to fetch" es error de red', esErrorDeRed(errRed))
prueba('"Load failed" (Safari) es error de red', esErrorDeRed({ message: 'Load failed' }))
prueba('"NetworkError when attempting to fetch" (Firefox) es error de red', esErrorDeRed({ message: 'NetworkError when attempting to fetch resource.' }))
prueba(
  'un error con código de la base (RLS, regla propia, duplicado) no es de red',
  !esErrorDeRed({ code: '42501', message: 'new row violates row-level security' }) &&
    !esErrorDeRed({ code: 'P0001', message: 'No hay un torneo abierto' }) &&
    !esErrorDeRed({ code: '23505', message: 'duplicate key' })
)
prueba('sin error no hay error de red', !esErrorDeRed(null) && !esErrorDeRed(undefined))
prueba('un fallo de renovación de sesión sin internet es de red', esErrorDeRed({ name: 'AuthRetryableFetchError', message: 'x' }))
prueba('el mensaje de la regla de la base se muestra tal cual', mensajeDe({ code: 'P0001', message: 'No hay un torneo abierto.' }) === 'No hay un torneo abierto.')

// ---------------------------------------------------------------- 2) La cola
console.log('\n2) Cola de resultados pendientes')
{
  const almacen = almacenFalso()
  const cola = crearCola(almacen)
  prueba('empieza vacía', cola.resumen().total === 0)
  cola.agregar(item(1))
  cola.agregar(item(2))
  prueba('guarda lo que se agrega, en orden', cola.leer().map((i) => i.id).join() === 'id-1,id-2')
  prueba('sobrevive a cerrar la página (otra cola sobre el mismo almacenamiento ve lo mismo)', crearCola(almacen).leer().length === 2)
  cola.marcar('id-2', { problema: 'No hay un torneo abierto.' })
  prueba(
    'el resumen separa los que esperan de los rechazados',
    JSON.stringify(cola.resumen()) === JSON.stringify({ total: 2, conProblema: 1, enEspera: 1, sincronizando: false })
  )
  let avisos = 0
  const baja = cola.suscribir(() => avisos++)
  cola.quitar('id-1')
  prueba('avisa a la pantalla cuando cambia', avisos === 1 && cola.resumen().total === 1)
  baja()
  cola.reintentarTodos()
  prueba('reintentar a mano limpia el rechazo', cola.resumen().conProblema === 0)
  const rota = almacenFalso()
  rota.setItem('tm-cola-resultados', '{no es json')
  prueba('un almacenamiento dañado no rompe la app', crearCola(rota).leer().length === 0)
  const sinAlmacen = crearCola(null)
  sinAlmacen.agregar(item(9))
  prueba('sin almacenamiento disponible la cola vive en memoria', sinAlmacen.leer().length === 1)
}

// ---------------------------------------------------------------- 3) Envío
console.log('\n3) Envío de los pendientes al volver internet')
{
  // Servidor simulado: guarda por id y rechaza repetidos como la clave primaria
  const servidor = (comportamiento = () => null) => {
    const guardados = []
    return {
      guardados,
      enviar: async (it) => {
        const extra = comportamiento(it)
        if (extra) return { error: extra }
        if (guardados.includes(it.id)) return { error: { code: '23505', message: 'duplicate key' } }
        guardados.push(it.id)
        return { error: null }
      },
    }
  }

  let cola = crearCola(almacenFalso())
  ;[1, 2, 3].forEach((n) => cola.agregar(item(n)))
  let srv = servidor()
  let r = await enviarPendientes(cola, srv.enviar, 'u1')
  prueba('envía todo en orden y vacía la cola', r.enviados === 3 && !r.sinRed && cola.resumen().total === 0 && srv.guardados.join() === 'id-1,id-2,id-3')

  cola = crearCola(almacenFalso())
  ;[1, 2, 3].forEach((n) => cola.agregar(item(n)))
  srv = servidor((it) => (it.id === 'id-2' ? errRed : null))
  r = await enviarPendientes(cola, srv.enviar, 'u1')
  prueba('si se corta internet a la mitad, se detiene y no pierde nada', r.sinRed && r.enviados === 1 && cola.leer().map((i) => i.id).join() === 'id-2,id-3')
  srv = servidor()
  r = await enviarPendientes(cola, srv.enviar, 'u1')
  prueba('al volver internet termina de enviar lo que faltaba', r.enviados === 2 && cola.resumen().total === 0)

  cola = crearCola(almacenFalso())
  cola.agregar(item(1))
  srv = servidor()
  await srv.enviar(item(1)) // llegó a la base, pero la respuesta se perdió
  r = await enviarPendientes(cola, srv.enviar, 'u1')
  prueba('si ya había llegado, el reintento lo da por enviado y no lo duplica', cola.resumen().total === 0 && srv.guardados.length === 1)

  cola = crearCola(almacenFalso())
  ;[1, 2].forEach((n) => cola.agregar(item(n)))
  srv = servidor((it) => (it.id === 'id-1' ? { code: 'P0001', message: 'No hay un torneo abierto. Abrí uno.' } : null))
  r = await enviarPendientes(cola, srv.enviar, 'u1')
  const rechazado = cola.leer().find((i) => i.id === 'id-1')
  prueba(
    'lo que la base rechaza queda marcado con el motivo y no frena al resto',
    rechazado?.problema === 'No hay un torneo abierto. Abrí uno.' && rechazado.intentos === 1 && srv.guardados.join() === 'id-2'
  )
  const intentados = []
  await enviarPendientes(cola, async (it) => { intentados.push(it.id); return { error: null } }, 'u1')
  prueba('los rechazados no se reintentan solos', intentados.length === 0 && cola.resumen().total === 1)
  await enviarPendientes(cola, async (it) => { intentados.push(it.id); return { error: null } }, 'u1', { incluirRechazados: true })
  prueba('con "Reintentar" sí se vuelven a enviar', intentados.join() === 'id-1' && cola.resumen().total === 0)

  cola = crearCola(almacenFalso())
  cola.agregar(item(1, { creadoPor: 'u1' }))
  cola.agregar(item(2, { creadoPor: 'u2' }))
  srv = servidor()
  await enviarPendientes(cola, srv.enviar, 'u2')
  prueba('cada resultado se envía solo con la sesión de quien lo cargó', srv.guardados.join() === 'id-2' && cola.leer().map((i) => i.id).join() === 'id-1')

  cola = crearCola(almacenFalso())
  cola.agregar(item(1))
  r = await enviarPendientes(cola, async () => { throw new TypeError('Failed to fetch') }, 'u1')
  prueba('una excepción de red se trata como falta de conexión', r.sinRed && cola.resumen().total === 1)
}

// ---------------------------------------------------------------- 4) Service worker
console.log('\n4) Service worker: la app abre sin internet')
{
  const aqui = dirname(fileURLToPath(import.meta.url))
  const plantilla = readFileSync(join(aqui, '../../public/sw.plantilla.js'), 'utf8')
  const ARCHIVOS = ['/ipponia/index.html', '/ipponia/assets/app-1.js', '/ipponia/assets/app-1.css', '/ipponia/icon-192.png']
  const codigo = plantilla.replace('__CACHE__', 'ipponia-NUEVA').replace('__BASE__', '/ipponia/').replace("'__ARCHIVOS__'", JSON.stringify(ARCHIVOS))

  // Entorno mínimo de un service worker: self, caches y fetch simulados
  const ORIGEN = 'https://sitio.test'
  const almacenes = new Map([['ipponia-VIEJA', new Map()], ['otra-app', new Map()]])
  const respuesta = (texto, ok = true) => ({ ok, texto, clone() { return this } })
  const claveDe = (p) => (typeof p === 'string' ? new URL(p, ORIGEN).href : p.url)
  const caches = {
    open: async (nombre) => {
      if (!almacenes.has(nombre)) almacenes.set(nombre, new Map())
      const m = almacenes.get(nombre)
      return {
        addAll: async (urls) => urls.forEach((u) => m.set(claveDe(u), respuesta(`archivo ${u}`))),
        put: async (p, r) => m.set(claveDe(p), r),
      }
    },
    keys: async () => [...almacenes.keys()],
    delete: async (n) => almacenes.delete(n),
    match: async (p) => {
      for (const m of almacenes.values()) if (m.has(claveDe(p))) return m.get(claveDe(p))
      return undefined
    },
  }
  let hayRed = true
  const pedidosALaRed = []
  const fetchFalso = async (p) => {
    pedidosALaRed.push(p.url)
    if (!hayRed) throw new TypeError('Failed to fetch')
    return respuesta(`red ${p.url}`)
  }
  const oyentes = {}
  const self = { addEventListener: (t, f) => { oyentes[t] = f }, skipWaiting: async () => {}, clients: { claim: async () => {} }, location: { origin: ORIGEN } }
  vm.runInNewContext(codigo, { self, caches, fetch: fetchFalso, URL, Promise, TypeError })

  const evento = (p) => ({ request: p, respuesta: undefined, espera: undefined, respondWith(x) { this.respuesta = x }, waitUntil(x) { this.espera = x } })
  const pedido = (url, extra = {}) => ({ url: `${ORIGEN}${url}`, method: 'GET', mode: 'same-origin', ...extra })

  const instalar = evento()
  oyentes.install(instalar)
  await instalar.espera
  prueba('al instalar, guarda todos los archivos de la versión', ARCHIVOS.every((u) => almacenes.get('ipponia-NUEVA').has(`${ORIGEN}${u}`)))
  const activar = evento()
  oyentes.activate(activar)
  await activar.espera
  prueba('al activar, borra la versión vieja de la app', !almacenes.has('ipponia-VIEJA'))
  prueba('y no toca lo guardado por otras aplicaciones', almacenes.has('otra-app'))

  hayRed = false
  let e = evento(pedido('/ipponia/kumite/kansa', { mode: 'navigate' }))
  oyentes.fetch(e)
  prueba('sin internet, abrir cualquier pantalla entrega la app guardada', (await e.respuesta).texto === 'archivo /ipponia/index.html')
  e = evento(pedido('/ipponia/assets/app-1.js'))
  oyentes.fetch(e)
  prueba('sin internet, los archivos de la app salen de lo guardado', (await e.respuesta).texto === 'archivo /ipponia/assets/app-1.js')

  hayRed = true
  pedidosALaRed.length = 0
  e = evento(pedido('/ipponia/kumite', { mode: 'navigate' }))
  oyentes.fetch(e)
  prueba('con internet, las páginas se piden primero a la red (siempre la versión nueva)', (await e.respuesta).texto === `red ${ORIGEN}/ipponia/kumite`)

  pedidosALaRed.length = 0
  e = evento(pedido('/ipponia/assets/app-1.css'))
  oyentes.fetch(e)
  await e.respuesta
  prueba('con internet, un archivo ya guardado no se vuelve a pedir', pedidosALaRed.length === 0)

  e = evento(pedido('/ipponia/assets/otro-2.js'))
  oyentes.fetch(e)
  await e.respuesta
  prueba('un archivo nuevo se pide a la red y se guarda para la próxima', almacenes.get('ipponia-NUEVA').has(`${ORIGEN}/ipponia/assets/otro-2.js`))

  for (const url of ['/ipponia/version.json', '/ipponia/sw.js']) {
    e = evento(pedido(url))
    oyentes.fetch(e)
    prueba(`${url} siempre va a la red (no se intercepta)`, e.respuesta === undefined)
  }
  e = evento({ url: 'https://abc.supabase.co/rest/v1/resultados_jurado', method: 'GET', mode: 'cors' })
  oyentes.fetch(e)
  prueba('lo que no es de este sitio (Supabase, tipografías) no se toca', e.respuesta === undefined)
  e = evento(pedido('/ipponia/api', { method: 'POST' }))
  oyentes.fetch(e)
  prueba('los envíos (POST) no se interceptan', e.respuesta === undefined)
}

console.log(`\nResultado: ${ok} pruebas correctas, ${fallos} fallidas.`)
process.exit(fallos ? 1 : 0)
