import { useDisplayState, usePublicTheme, useRanking } from '../hooks/usePublicDisplay'
import { MAX_PUESTOS, PUESTOS_PODIO, posiciones } from '../lib/ranking'
import { ListaRanking } from '../components/Ranking/Ranking'
import { mensajeEmpate, tituloRanking } from '../lib/rankingTextos'
import useArea, { etiquetaArea } from '../hooks/useArea'
import marcaClara from '../assets/images/ipponia-marca.png'
import marcaOscura from '../assets/images/ipponia-marca-oscuro.png'

// Marca discreta en una esquina: lo ve todo el público, así el producto se da a conocer.
// Cinturón negro en el tema claro y blanco en el oscuro (lo elige el CSS según el tema).
function MarcaAgua() {
  return (
    <div className="pk-marca" aria-hidden="true">
      <img src={marcaClara} alt="" className="pk-marca-clara" />
      <img src={marcaOscura} alt="" className="pk-marca-oscura" />
      <span className="pk-marca-texto">
        IPPONIA
        <small>TORNEOS EN VIVO</small>
      </span>
    </div>
  )
}
import './Kata.css'
import './Pantalla.css'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}

const FILAS_FALTAS = [
  { clave: 'chukoku', nombre: 'CHUKOKU' },
  { clave: 'mubobi', nombre: 'MUBOBI' },
]
const FILA_JOGAI = [{ clave: 'jogai', nombre: 'JOGAI' }]
const COLUMNAS_FALTAS = ['ADV', 'KEIK', 'H-CH', 'HANS']
const COLUMNAS_JOGAI = ['J1', 'J2', 'J3', 'J4']

// Recibe milisegundos y devuelve MM:SS.cc (centésimas)
function formatearTiempo(ms) {
  const m = Math.floor(ms / 60000).toString().padStart(2, '0')
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0')
  const c = Math.floor((ms % 1000) / 10).toString().padStart(2, '0')
  return `${m}:${s}.${c}`
}

function TablaFaltas({ filas, columnas, faltas }) {
  return (
    <table className="pk-faltas">
      <thead>
        <tr>
          <th>FALTAS</th>
          {columnas.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila.clave}>
            <td className="pk-falta-nombre">{fila.nombre}</td>
            {columnas.map((c) => (
              <td
                key={c}
                className={faltas[fila.clave].includes(c) ? 'pk-falta-marcada' : ''}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Competidor({ lado, titulo, datos }) {
  return (
    <section className={`pk-competidor pk-${lado}`}>
      <div className="pk-titulo">{titulo}</div>
      <div className="pk-nombre">{datos.nombre || ' '}</div>
      <div className="pk-total">{datos.total}</div>
      <div className="pk-total-label">Puntaje total</div>
      <TablaFaltas filas={FILAS_FALTAS} columnas={COLUMNAS_FALTAS} faltas={datos.faltas} />
      <TablaFaltas filas={FILA_JOGAI} columnas={COLUMNAS_JOGAI} faltas={datos.faltas} />
    </section>
  )
}

const NOMBRE_POR_DEFECTO = { shiro: 'SHIRO (BLANCO)', aka: 'AKA (ROJO)' }

function CartelGanador({ lado, state }) {
  const rival = lado === 'shiro' ? 'aka' : 'shiro'
  const nombreDe = (l) => state[l].nombre || NOMBRE_POR_DEFECTO[l]
  return (
    <div className={`pk-ganador pk-ganador-${lado}`}>
      <div className="pk-ganador-label">🏆 GANADOR</div>
      <div className="pk-ganador-nombre">{nombreDe(lado)}</div>
      <div className="pk-ganador-card">
        <div className="pk-ganador-card-label">Puntaje final</div>
        <div className="pk-ganador-card-valor">{state[lado].total}</div>
      </div>
      <div className="pk-ganador-vs">
        vs {nombreDe(rival)}: {state[rival].total}
      </div>
    </div>
  )
}

function PantallaKumite({ state, area }) {
  const titulo = [area && etiquetaArea(area), state.categoria || 'KUMITE'].filter(Boolean).join(' · ')
  return (
    <div className="pk-pantalla" onDoubleClick={toggleFullscreen}>
      <div className="pk-cabecera">
        <div className="pk-categoria">{titulo}</div>
        <div className="pk-reloj">{formatearTiempo(state.duration)}</div>
        {state.enchoSen && <div className="pk-encho">ENCHO-SEN</div>}
      </div>

      <div className="pk-columnas">
        <Competidor lado="shiro" titulo="SHIRO (BLANCO)" datos={state.shiro} />
        <Competidor lado="aka" titulo="AKA (ROJO)" datos={state.aka} />
      </div>

      {state.ganador && <CartelGanador lado={state.ganador} state={state} />}
    </div>
  )
}

// Destreza en vivo: nombre del equipo y cronómetro grande
function PantallaDestreza({ state, area }) {
  return (
    <div className="pk-pantalla" onDoubleClick={toggleFullscreen}>
      <div className="pk-vivo">
        <div className="pk-categoria pk-vivo-titulo">
          {[area && etiquetaArea(area), 'DESTREZA'].filter(Boolean).join(' · ')}
        </div>
        <div className="pk-vivo-nombre">{state.equipo || ' '}</div>
        <div className="pk-reloj pk-reloj-grande">{formatearTiempo(state.duration)}</div>
      </div>
    </div>
  )
}

// Ranking de la ronda: los 8 mejores puntajes, con el podio destacado en oro, plata y bronce.
// Según cómo lo marcó la mesa (`cierre`): fin de la ronda, empate a resolver o resultado final de la categoría (solo el podio).
function PantallaRanking({ ranking }) {
  const final = ranking.cierre === 'categoria'
  const filas = posiciones(ranking.filas, final ? PUESTOS_PODIO : MAX_PUESTOS)
  const empate = mensajeEmpate(filas)
  const titulo = tituloRanking(ranking) + (ranking.cierre === 'ronda' ? ' · Finalizada' : '')
  const pie = empate ?? (final ? 'Resultado de la categoría' : ranking.cierre === 'ronda' ? 'Los 8 mejores de la ronda' : 'Esperando al próximo competidor…')

  return (
    <div className="pr-pantalla pr-tema" onDoubleClick={toggleFullscreen}>
      <div className="pr-cabecera">
        <div className="pr-modulo">{titulo}</div>
        <div className="pr-titulo">{final ? 'PODIO' : 'RANKING'}</div>
      </div>
      <ListaRanking filas={filas} ultimo={ranking.cierre ? null : ranking.ultimo} />
      <div className={`pr-pie ${empate ? 'pr-pie-empate' : ''}`}>{pie}</div>
    </div>
  )
}

function PantallaContenido() {
  const state = useDisplayState()
  const ranking = useRanking()
  usePublicTheme()
  const { area } = useArea()

  // El ranking se ve solo entre competidores: sin resultado en pantalla (o, en Destreza, con el cronómetro
  // todavía sin equipo) y desde que hay al menos un puntaje.
  const entreCompetidores = !state || (state.tipo === 'destreza' && !state.equipo?.trim())
  if (ranking && entreCompetidores) return <PantallaRanking ranking={ranking} />

  if (!state) {
    return (
      <div className="pantalla-espera" onDoubleClick={toggleFullscreen}>
        <div className={`pantalla-espera-titulo ${area ? 'pantalla-espera-area' : ''}`}>
          {area ? etiquetaArea(area) : 'IPPONIA'}
        </div>
        {!area && <div className="pantalla-espera-lema">TORNEOS EN VIVO</div>}
        <div className="pantalla-espera-texto">Esperando resultado…</div>
      </div>
    )
  }

  if (state.tipo === 'kumite') {
    return <PantallaKumite state={state} area={area} />
  }

  if (state.tipo === 'destreza') {
    return <PantallaDestreza state={state} area={area} />
  }

  return (
    <div className="results-overlay pantalla-publica" onDoubleClick={toggleFullscreen}>
      <div className="results-board">
        <div className="pantalla-modulo">
          {area && `${etiquetaArea(area)} · `}
          {state.modulo}
          {state.duration != null && ` · ${formatearTiempo(state.duration)}`}
        </div>

        <div className="system-badge">{state.competitor}</div>

        <div className="results-grid">
          <div className="result-card final">
            <div className="result-icon">🏆</div>
            <div className="result-label">Puntaje Final</div>
            <div className="result-value-final">{state.finalScore}</div>
          </div>
        </div>

        <div className="results-detail">
          <h3>Detalles de Calificaciones</h3>
          <div className="scores-breakdown">
            {state.scores.map((item) => (
              <div
                key={item.label}
                className={`score-item ${item.included ? 'included' : 'discarded'}`}
              >
                <span className="score-position">{item.included ? '✅' : '❌'}</span>
                <span className="score-value">{item.score.toFixed(1)}</span>
                <span className="judge-label">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Pantalla() {
  return (
    <>
      <PantallaContenido />
      <MarcaAgua />
    </>
  )
}

export default Pantalla
