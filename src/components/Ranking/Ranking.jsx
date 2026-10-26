import { MAX_PUESTOS, PUESTOS_PODIO, posiciones } from '../../lib/ranking'
import { mensajeEmpate, tituloRanking } from '../../lib/rankingTextos'
import './Ranking.css'

function Fila({ f, ultimo }) {
  const desempate = f.desempates?.length ? f.desempates[f.desempates.length - 1] : null
  const top = f.puesto <= PUESTOS_PODIO
  return (
    <div className={`pr-fila ${top ? `pr-top pr-puesto-${f.puesto}` : ''}`}>
      <div className="pr-pos">{f.puesto}</div>
      <div className="pr-nombre">
        <span className="pr-nombre-texto">{f.competidor}</span>
        {f.id === ultimo && <span className="pr-nuevo">NUEVO</span>}
        {f.empatado && <span className="pr-empate">EMPATE</span>}
        {top && f.kata && <span className="pr-kata">{f.kata}</span>}
        {f.criterios?.map((c) => (
          <span key={c.tipo} className="pr-kata pr-criterio">
            Desempate por puntaje más {c.tipo === 'menor' ? 'bajo' : 'alto'}: {c.valor.toFixed(2)}
          </span>
        ))}
        {desempate && <span className="pr-kata">Nueva pasada: {desempate.puntaje.toFixed(2)}</span>}
      </div>
      <div className="pr-puntaje">{f.puntaje.toFixed(2)}</div>
    </div>
  )
}

// Los puestos: el podio (1.º, 2.º y 3.º) a la izquierda, destacado, y del 4.º al 8.º a la derecha.
// `filas` viene de posiciones(). Con 3 puestos o menos, el podio queda en una sola columna centrada.
export function ListaRanking({ filas, ultimo }) {
  const podio = filas.filter((f) => f.puesto <= PUESTOS_PODIO)
  const resto = filas.filter((f) => f.puesto > PUESTOS_PODIO)
  return (
    <div className={`pr-cuerpo ${resto.length === 0 ? 'pr-una-columna' : ''}`}>
      <div className="pr-columna">{podio.map((f) => <Fila key={f.id} f={f} ultimo={ultimo} />)}</div>
      {resto.length > 0 && <div className="pr-columna">{resto.map((f) => <Fila key={f.id} f={f} ultimo={ultimo} />)}</div>}
    </div>
  )
}

// Ventana de la mesa con el ranking. `vista`: { tipo, ranking }
//   parcial    "Ver ranking" mientras se arma: los 8 mejores
//   ronda      al tocar "Siguiente ronda": los 8 mejores de la ronda que terminó
//   empate     al tocar "Finalizar categoría" con empate en el podio: hay que desempatar
//   categoria  al tocar "Finalizar categoría" con el podio definido: resultado de la categoría
export function RankingMesa({ vista, onCerrar, onConfirmar }) {
  if (!vista) return null
  const { tipo, ranking } = vista
  const filas = posiciones(ranking.filas, tipo === 'categoria' ? PUESTOS_PODIO : MAX_PUESTOS)
  const empate = mensajeEmpate(filas)

  const titulos = {
    parcial: 'Ranking · los 8 mejores',
    ronda: `Fin de la ronda ${ranking.ronda ?? ''} · los 8 mejores`,
    empate: 'Hay un empate en el podio',
    categoria: 'Resultado de la categoría',
  }

  return (
    <div className="pr-modal" onClick={tipo === 'categoria' ? undefined : onCerrar}>
      <div className="pr-modal-caja pr-tema" role="dialog" aria-label={titulos[tipo]} onClick={(e) => e.stopPropagation()}>
        <div className="pr-modal-modulo">{tituloRanking(ranking)}</div>
        <h2 className="pr-modal-titulo">{titulos[tipo]}</h2>
        <ListaRanking filas={filas} ultimo={tipo === 'parcial' ? ranking.ultimo : null} />
        {empate && <p className="pr-modal-aviso">{empate}</p>}
        <div className="pr-modal-acciones">
          {tipo === 'categoria' ? (
            <>
              <button type="button" className="pr-btn" onClick={onCerrar}>
                Volver
              </button>
              <button type="button" className="pr-btn pr-btn-primario" onClick={onConfirmar}>
                Cerrar la categoría
              </button>
            </>
          ) : (
            <button type="button" className="pr-btn pr-btn-primario" onClick={onCerrar}>
              {tipo === 'ronda' ? `Continuar con la ronda ${(ranking.ronda ?? 0) + 1}` : tipo === 'empate' ? 'Entendido' : 'Cerrar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
