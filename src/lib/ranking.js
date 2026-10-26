// Ranking de la pantalla pública y de la mesa (Kata, Kobudo y Destreza): los mejores puntajes de la ronda.
//
// Cada vez que se calcula un resultado, el panel de control lo anota acá (en el navegador, bajo la clave
// 'tm-ranking'); la pantalla pública, que es otra ventana del mismo navegador, se entera por el evento
// 'storage' y lo muestra entre competidores.
//
// Reglas:
//   * Es un ranking por ronda: el primer puntaje de otra ronda (u otro módulo o área) empieza uno nuevo.
//   * Si un competidor puntúa de nuevo y NO está empatado, es una corrección: vale el último puntaje.
//   * Desempate con el sistema de 5 jueces (a igual puntaje final): gana quien tenga el MENOR puntaje más alto;
//     si también empatan, quien tenga el MAYOR puntaje más alto. Con 3 jueces no hay criterio de desempate.
//   * Si siguen empatados, comparten puesto (1.º, 2.º, 2.º, 4.º) y quedan marcados: deben volver a pasar.
//     Cuando un competidor EMPATADO puntúa de nuevo, ese puntaje es de desempate: no reemplaza al original, se
//     guarda aparte y solo ordena a los empatados entre sí (con los mismos criterios de arriba). Mientras algún
//     empatado no haya vuelto a pasar, el empate sigue. Si vuelven a empatar, pasan otra vez.
//     Entre empatados se lista primero a quien puntuó antes.
//   * Se muestran los 8 primeros puestos (si hay empate en el 8.º, entran todos los empatados).
//   * "Siguiente ronda" muestra el ranking de la ronda; "Finalizar categoría" muestra el podio (3 primeros) y,
//     si hay empate en el podio, no cierra la categoría hasta resolverlo (ver `resultadoDeCategoria`).
//   * Un ranking de más de 12 horas se considera olvidado (alguien no cerró la categoría) y no se muestra.

export const MAX_PUESTOS = 8
export const PUESTOS_PODIO = 3
const CLAVE = 'tm-ranking'
const VIGENCIA_MS = 12 * 60 * 60 * 1000

const redondear = (n) => Math.round(Number(n) * 100) / 100
const numeroOnull = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? null : redondear(n))
const normalizar = (texto) => String(texto ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// Almacenamiento del navegador, tolerante a que no esté disponible (modo privado, pruebas en Node)
function almacenLocal() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // sin acceso al almacenamiento
  }
  return null
}

const conCincoJueces = (r) => r.sistema === 5 && r.menor != null && r.mayor != null

// Compara dos resultados: negativo si `a` va antes, positivo si va `b`, 0 si están empatados.
// Mismo puntaje final y los dos con 5 jueces: primero el menor puntaje más alto, después el mayor puntaje más alto.
export function comparar(a, b) {
  if (a.puntaje !== b.puntaje) return b.puntaje - a.puntaje
  if (conCincoJueces(a) && conCincoJueces(b)) {
    if (a.menor !== b.menor) return b.menor - a.menor
    if (a.mayor !== b.mayor) return b.mayor - a.mayor
  }
  return 0
}

// Parte una lista ya ordenada en bloques de iguales según `clave(elemento)`
function bloquesDeIguales(ordenados, clave) {
  const bloques = []
  for (const f of ordenados) {
    const ultimo = bloques[bloques.length - 1]
    if (ultimo && comparar(clave(ultimo[0]), clave(f)) === 0) ultimo.push(f)
    else bloques.push([f])
  }
  return bloques
}

// Resuelve un bloque de empatados con sus puntajes de desempate: la vuelta k solo cuenta si TODOS pasaron
function resolverDesempate(bloque, k) {
  if (bloque.length <= 1) return [bloque]
  if (!bloque.every((f) => (f.desempates?.length ?? 0) > k)) return [bloque]
  const orden = [...bloque].sort((a, b) => comparar(a.desempates[k], b.desempates[k]) || a.en - b.en)
  return bloquesDeIguales(orden, (f) => f.desempates[k]).flatMap((sub) => resolverDesempate(sub, k + 1))
}

// Todos los competidores en bloques de puesto: un bloque de más de uno es un empate sin resolver
export function agruparPuestos(filas = []) {
  const ordenadas = [...filas].sort((a, b) => comparar(a, b) || a.en - b.en)
  return bloquesDeIguales(ordenadas, (f) => f).flatMap((bloque) => resolverDesempate(bloque, 0))
}

// Para los competidores con el MISMO puntaje final y 5 jueces, qué puntaje los distinguió:
//   { tipo: 'menor' | 'mayor', valor } por competidor. Primero cuenta el menor puntaje; el mayor, solo entre los
//   que tienen el mismo menor. Si todo es igual (siguen empatados) no hay nada que mostrar.
export function criteriosDeDesempate(filas = []) {
  const criterios = new Map(filas.map((f) => [f.id, []]))
  const porPuntaje = new Map()
  for (const f of filas) porPuntaje.set(f.puntaje, [...(porPuntaje.get(f.puntaje) ?? []), f])
  for (const grupo of porPuntaje.values()) {
    if (grupo.length < 2 || !grupo.every(conCincoJueces)) continue
    if (new Set(grupo.map((f) => f.menor)).size > 1) grupo.forEach((f) => criterios.get(f.id).push({ tipo: 'menor', valor: f.menor }))
    const porMenor = new Map()
    for (const f of grupo) porMenor.set(f.menor, [...(porMenor.get(f.menor) ?? []), f])
    for (const sub of porMenor.values()) {
      if (sub.length > 1 && new Set(sub.map((f) => f.mayor)).size > 1) sub.forEach((f) => criterios.get(f.id).push({ tipo: 'mayor', valor: f.mayor }))
    }
  }
  return criterios
}

// Los de los primeros `max` puestos, ordenados, con su `puesto` (los empatados comparten puesto), `empatado`
// (true si otro competidor tiene el mismo puesto: tienen que volver a pasar para desempatar) y `criterios`
// (el menor y/o el mayor puntaje que decidió su lugar frente a otro con el mismo puntaje final).
export function posiciones(filas = [], max = MAX_PUESTOS) {
  const criterios = criteriosDeDesempate(filas)
  let puesto = 1
  const resultado = []
  for (const bloque of agruparPuestos(filas)) {
    for (const f of bloque) resultado.push({ ...f, puesto, empatado: bloque.length > 1, criterios: criterios.get(f.id) ?? [] })
    puesto += bloque.length
  }
  return resultado.filter((f) => f.puesto <= max)
}

// Puestos en los que hay empate sin resolver, de menor a mayor (por ejemplo [2, 5])
export const puestosEmpatados = (filas) => [...new Set(filas.filter((f) => f.empatado).map((f) => f.puesto))].sort((a, b) => a - b)

// Qué mostrar al tocar "Finalizar categoría": el podio, o el empate que hay que resolver antes.
//   estado: 'vacio' (no hay puntajes) | 'empate' (hay empate en el podio) | 'listo' (el podio está definido)
export function resultadoDeCategoria(ranking) {
  const filas = posiciones(ranking?.filas ?? [], PUESTOS_PODIO)
  if (filas.length === 0) return { estado: 'vacio', filas: [], empates: [] }
  const empates = puestosEmpatados(filas)
  return { estado: empates.length ? 'empate' : 'listo', filas, empates }
}

// Suma un resultado al ranking. Función pura: devuelve el ranking nuevo sin tocar el anterior.
//   ranking: el actual (o null)   resultado: { modulo, area, ronda, competidor, kata, puntaje, ahora }
//   sistema (3 o 5 jueces), menor y mayor: el puntaje más bajo y el más alto de los jueces (para el desempate)
export function agregarResultado(
  ranking,
  { modulo, area = null, ronda = null, competidor, kata = null, puntaje, sistema = null, menor = null, mayor = null, ahora = Date.now() }
) {
  // una categoría ya cerrada no se sigue: el primer puntaje de la siguiente empieza un ranking nuevo
  const mismoGrupo = ranking && ranking.cierre !== 'categoria' && ranking.modulo === modulo && ranking.area === area && ranking.ronda === ronda
  const filas = mismoGrupo ? ranking.filas : []
  const id = normalizar(competidor) || `sin-nombre-${ahora}`
  const dato = {
    puntaje: redondear(puntaje),
    sistema: sistema == null ? null : Number(sistema),
    menor: numeroOnull(menor),
    mayor: numeroOnull(mayor),
  }
  const base = { modulo, area, ronda, actualizadoEn: ahora, ultimo: id, cierre: null }

  // ¿Es un puntaje de desempate? Sí, si el competidor ya está en el ranking y hoy está empatado.
  const bloque = agruparPuestos(filas).find((b) => b.some((f) => f.id === id))
  if (bloque && bloque.length > 1) {
    const vueltaEnCurso = Math.min(...bloque.map((f) => f.desempates?.length ?? 0))
    return {
      ...base,
      filas: filas.map((f) => {
        if (f.id !== id) return f
        const propios = f.desempates ?? []
        // si ya pasó en esta vuelta, es una corrección de su puntaje de desempate
        const lugar = Math.min(propios.length, vueltaEnCurso)
        return { ...f, desempates: [...propios.slice(0, lugar), { ...dato, en: ahora }] }
      }),
    }
  }

  const entrada = {
    id,
    competidor: String(competidor ?? '').trim() || 'Sin nombre',
    kata: String(kata ?? '').trim() || null,
    ...dato,
    desempates: [],
    en: ahora,
  }
  return { ...base, filas: [...filas.filter((f) => f.id !== id), entrada] }
}

// ¿Pasaron demasiadas horas desde el último puntaje?
export const estaVencido = (ranking, ahora = Date.now()) => !ranking || ahora - (ranking.actualizadoEn ?? 0) > VIGENCIA_MS

// ---- Lectura y escritura en el navegador

export function leerRanking(almacen = almacenLocal(), ahora = Date.now()) {
  try {
    const ranking = JSON.parse(almacen?.getItem(CLAVE) ?? 'null')
    return ranking && Array.isArray(ranking.filas) && ranking.filas.length > 0 && !estaVencido(ranking, ahora) ? ranking : null
  } catch {
    return null
  }
}

// Anota el resultado de un competidor. Sin puntaje válido no hace nada.
export function registrarEnRanking(resultado, almacen = almacenLocal()) {
  if (!almacen || resultado.puntaje == null || !Number.isFinite(Number(resultado.puntaje))) return
  try {
    const actual = JSON.parse(almacen.getItem(CLAVE) ?? 'null')
    almacen.setItem(CLAVE, JSON.stringify(agregarResultado(actual, resultado)))
  } catch {
    // sin almacenamiento disponible: la pantalla pública simplemente no muestra el ranking
  }
}

// Marca cómo se está mostrando el ranking: 'ronda' (terminó la ronda), 'empate' (hay que desempatar para cerrar
// la categoría), 'categoria' (resultado final) o null (ranking común). El próximo puntaje vuelve a null.
export function marcarCierre(cierre, almacen = almacenLocal()) {
  try {
    const actual = JSON.parse(almacen?.getItem(CLAVE) ?? 'null')
    if (actual) almacen.setItem(CLAVE, JSON.stringify({ ...actual, cierre }))
  } catch {
    // sin almacenamiento disponible
  }
}

export function limpiarRanking(almacen = almacenLocal()) {
  try {
    almacen?.removeItem(CLAVE)
  } catch {
    // nada que borrar
  }
}

export const CLAVE_RANKING = CLAVE
