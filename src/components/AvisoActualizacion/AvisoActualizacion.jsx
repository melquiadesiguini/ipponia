import { useState } from 'react'
import { useVersionNueva } from '../../hooks/useApp'
import { aplicarActualizacion } from '../../lib/serviceWorker'
import s from './AvisoActualizacion.module.css'

// Aviso chico abajo: hay una versión nueva de Ipponia. No se aplica sola para no cortar un combate en curso.
function AvisoActualizacion() {
  const hayNueva = useVersionNueva()
  const [oculto, setOculto] = useState(false)
  if (!hayNueva || oculto) return null

  return (
    <div className={s.aviso} role="status">
      <span>Hay una versión nueva de Ipponia.</span>
      <button type="button" className={s.actualizar} onClick={aplicarActualizacion}>
        Actualizar
      </button>
      <button type="button" className={s.luego} onClick={() => setOculto(true)} aria-label="Avisarme más tarde">
        Más tarde
      </button>
    </div>
  )
}

export default AvisoActualizacion
