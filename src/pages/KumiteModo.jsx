import { useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header/Header'
import Footer from '../components/Footer/Footer'
import useAuth from '../hooks/useAuth'
import { PERMISOS_MODULO } from '../lib/permisos'
import './KumiteModo.css'

// Pantalla previa a Kumite, en dos pasos:
//   1. el sistema de jueces (3 o 5), que se guarda con cada combate
//   2. el rol con el que se va a usar el tablero (Mesa o Kansa)
// El sistema elegido viaja en la dirección (?jueces=3), así sobrevive a recargar la página.
// Cada usuario ve solo el rol que le corresponde (Mesa o Kansa); con un solo rol, aparece solo esa tarjeta.
function KumiteModo() {
  const [jueces, setJueces] = useState(null)
  const { configurado, puedeAlguno } = useAuth()
  const veMesa = !configurado || puedeAlguno(PERMISOS_MODULO.kumiteMesa)
  const veKansa = !configurado || puedeAlguno(PERMISOS_MODULO.kumiteKansa)

  return (
    <div className="pagina-columna">
      <Header />
      <main className="modo-container">
        <h1 className="modo-titulo">Kumite</h1>

        {!jueces ? (
          <>
            <p className="modo-subtitulo">¿Con cuántos jueces se va a trabajar?</p>

            <div className="modo-opciones">
              <button type="button" className="modo-card modo-jueces" onClick={() => setJueces(3)}>
                <span className="modo-icono" aria-hidden="true">👥</span>
                <span className="modo-nombre">3 JUECES</span>
                <span className="modo-detalle">Sistema de tres jueces</span>
              </button>

              <button type="button" className="modo-card modo-jueces" onClick={() => setJueces(5)}>
                <span className="modo-icono" aria-hidden="true">👥👥</span>
                <span className="modo-nombre">5 JUECES</span>
                <span className="modo-detalle">Sistema de cinco jueces</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modo-subtitulo">Elegí cómo vas a usar el tablero ({jueces} jueces)</p>

            <div className={`modo-opciones ${veMesa && veKansa ? '' : 'modo-opciones-una'}`}>
              {veMesa && (
                <Link to={`/kumite/mesa?jueces=${jueces}`} className="modo-card modo-mesa">
                  <span className="modo-icono" aria-hidden="true">🖥️</span>
                  <span className="modo-nombre">MESA</span>
                  <span className="modo-detalle">
                    Tablero completo: cronómetro, puntajes, faltas y resultado
                  </span>
                </Link>
              )}

              {veKansa && (
                <Link to={`/kumite/kansa?jueces=${jueces}`} className="modo-card modo-kansa">
                  <span className="modo-icono" aria-hidden="true">🚩</span>
                  <span className="modo-nombre">KANSA</span>
                  <span className="modo-detalle">
                    Mismo tablero que la Mesa, pero independiente: no la modifica ni se ve en la pantalla pública
                  </span>
                </Link>
              )}
            </div>

            <button type="button" className="modo-volver" onClick={() => setJueces(null)}>
              ← Cambiar el sistema de jueces
            </button>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}

export default KumiteModo
