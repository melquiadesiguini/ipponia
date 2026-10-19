import { useEnLinea, useCola } from '../../hooks/useConexion'
import { cola } from '../../lib/colaResultados'
import { sincronizarPendientes } from '../../lib/resultados'
import s from './EstadoConexion.module.css'

// Aviso chico en el encabezado: sin conexión, resultados esperando para enviarse o rechazados.
// No muestra nada cuando está todo en orden.
function EstadoConexion() {
  const enLinea = useEnLinea()
  const { total, conProblema, enEspera, sincronizando } = useCola()

  if (enLinea && total === 0) return null

  const reintentar = () => {
    cola.reintentarTodos()
    sincronizarPendientes({ incluirRechazados: true })
  }

  let texto
  let clase = s.aviso
  if (!enLinea) {
    texto = total ? `Sin conexión · ${total} por enviar` : 'Sin conexión'
    clase = `${s.aviso} ${s.sinRed}`
  } else if (sincronizando) {
    texto = `Enviando ${total}…`
  } else if (conProblema) {
    texto = `${conProblema} sin enviar`
    clase = `${s.aviso} ${s.problema}`
  } else {
    texto = `${enEspera} por enviar`
  }

  return (
    <span
      className={clase}
      role="status"
      title={
        !enLinea
          ? 'Podés seguir trabajando: los resultados se guardan en este dispositivo y se envían solos cuando vuelva internet.'
          : conProblema
            ? 'La base rechazó algunos resultados (por ejemplo, no había un torneo abierto). Tocá para reintentar.'
            : 'Resultados guardados en este dispositivo que se están enviando.'
      }
    >
      <span aria-hidden="true">{enLinea ? '⟳' : '📴'}</span> {texto}
      {enLinea && conProblema > 0 && (
        <button type="button" className={s.reintentar} onClick={reintentar}>
          Reintentar
        </button>
      )}
    </span>
  )
}

export default EstadoConexion
