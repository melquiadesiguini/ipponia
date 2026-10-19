import { useState } from 'react'
import { useInstalacion } from '../../hooks/useApp'
import { instalarApp } from '../../lib/instalacion'

// En "Mi cuenta": instalar Ipponia como app. Abre sin la barra del navegador, con su ícono propio,
// y funciona sin internet (ver el modo sin conexión).
function InstalarApp() {
  const { puedeInstalar, instalada, esApple } = useInstalacion()
  const [trabajando, setTrabajando] = useState(false)

  if (instalada) return <p className="cuenta-nota">✅ Ipponia está instalada en este dispositivo.</p>

  const instalar = async () => {
    setTrabajando(true)
    await instalarApp()
    setTrabajando(false)
  }

  return (
    <div className="cuenta-dato">
      Instalar en este dispositivo
      <p className="cuenta-nota">
        Se abre como una app, con su propio ícono y sin la barra del navegador, y sigue funcionando sin internet.
      </p>
      {puedeInstalar ? (
        <button type="button" className="cuenta-boton cuenta-boton-primario" onClick={instalar} disabled={trabajando}>
          Instalar Ipponia
        </button>
      ) : esApple ? (
        <p className="cuenta-nota">
          En Safari tocá el botón <strong>Compartir</strong> y elegí <strong>Agregar a pantalla de inicio</strong>.
        </p>
      ) : (
        <p className="cuenta-nota">
          Desde el menú del navegador elegí <strong>Instalar aplicación</strong> (o <strong>Agregar a la pantalla de inicio</strong>).
        </p>
      )}
    </div>
  )
}

export default InstalarApp
