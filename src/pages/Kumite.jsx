import { useEffect, useRef, useState } from 'react'
import Header from '../components/Header/Header'
import Footer from '../components/Footer/Footer'
import AreaField from '../components/AreaField/AreaField'
import ResponsableField from '../components/ResponsableField/ResponsableField'
import { leerResponsable } from '../hooks/useResponsableMesa'
import useTorneoAbierto, { MENSAJE_SIN_TORNEO } from '../hooks/useTorneoAbierto'
import { guardarResultado, mensajeGuardado } from '../lib/resultados'
import Timer from '../components/Timer/Timer'
import Marcador from '../components/Marcador/Marcador'
import useCountUp from '../hooks/useCountUp'
import useFitToScreen from '../hooks/useFitToScreen'
import useAlturaHeader from '../hooks/useAlturaHeader'
import { openPublicDisplay, usePublishLive } from '../hooks/usePublicDisplay'
import '../pages/Kumite.css'

// Duraciones del combate (en milisegundos)
// Relleno vertical total (arriba + abajo) de .kumite-container, en px
const PADDING_VERTICAL_TABLERO = 24
// Hasta cuánto se agranda el tablero en pantallas grandes para llenar el alto
const ESCALA_MAXIMA_TABLERO = 3

const DURACION_COMBATE = 60 * 1000
const DURACION_ENCHO_SEN = 60 * 1000

// `modoKansa`: es el mismo tablero que la Mesa, pero independiente: no publica nada
// para la pantalla pública ni toca el tablero de la Mesa (cada ventana lleva su combate).
function Kumite({ modoKansa = false, sistemaJueces = null }) {
  // El tablero ocupa el 100 % del alto de la pantalla (debajo del encabezado), sin scroll:
  // se achica si no entra y se agranda si sobra espacio.
  // En tablet y celular se puede pasar a pantalla completa: se ocultan el encabezado y el pie
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  const alturaHeader = useAlturaHeader(!pantallaCompleta)
  const { contentRef, scale } = useFitToScreen(true, alturaHeader + PADDING_VERTICAL_TABLERO, false, ESCALA_MAXIMA_TABLERO)

  // Si el navegador sale de pantalla completa por su cuenta (Esc, gesto), se vuelve a mostrar el encabezado
  useEffect(() => {
    const alCambiar = () => {
      if (!document.fullscreenElement) setPantallaCompleta(false)
    }
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  // Pide pantalla completa al navegador; donde no existe (iPhone) alcanza con ocultar encabezado y pie
  const alternarPantallaCompleta = () => {
    const entrar = !pantallaCompleta
    setPantallaCompleta(entrar)
    if (entrar) document.documentElement.requestFullscreen?.().catch(() => {})
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }

  const [categoria, setCategoria] = useState('')
  const { sinTorneo } = useTorneoAbierto()
  const [duration, setDuration] = useState(DURACION_COMBATE)
  const [timerActive, setTimerActive] = useState(false)

  const [nombres, setNombres] = useState({ shiro: '', aka: '' })
  const cambiarNombre = (competidor, valor) => {
    setNombres((prev) => ({ ...prev, [competidor]: valor }))
  }
  const nombreDe = (competidor) =>
    nombres[competidor].trim() ||
    (competidor === 'shiro' ? 'SHIRO (BLANCO)' : 'AKA (ROJO)')

  const estadoVacio = () => ({ ippon: 0, nibon: 0, sanbon: 0, penalizacion: 0 })
  const [estado, setEstado] = useState({
    shiro: estadoVacio(),
    aka: estadoVacio(),
  })

  const faltasVacias = () => ({ chukoku: [], mubobi: [], jogai: [] })
  const [faltas, setFaltas] = useState({
    shiro: faltasVacias(),
    aka: faltasVacias(),
  })

  // null | 'shiro' | 'aka' | 'empate'
  const [ganador, setGanador] = useState(null)
  const [enchoSen, setEnchoSen] = useState(false)
  const [resultadoVisible, setResultadoVisible] = useState(true)

  const oponenteDe = (competidor) => (competidor === 'shiro' ? 'aka' : 'shiro')

  // Puntos que se le suman al RIVAL al marcar cada falta
  const PUNTOS_POR_FALTA = { KEIK: 1, 'H-CH': 2, HANS: 3, J2: 1, J3: 2, J4: 3 }
  const esFaltaGanadora = (columna) => columna === 'HANS' || columna === 'J4'

  // Salida del combate (SHIKAKU / KIKEN / ORDEN MÉDICA): gana el otro competidor.
  // null | { competidor, motivo }
  const [salida, setSalida] = useState(null)

  // Calcular el total a partir de un objeto de estado de competidor
  const calcularTotalDesde = (estadoCompetidor) =>
    estadoCompetidor.ippon * 1 +
    estadoCompetidor.nibon * 2 +
    estadoCompetidor.sanbon * 3 +
    estadoCompetidor.penalizacion

  // Calcular totales
  const calcularTotal = (competidor) => calcularTotalDesde(estado[competidor])

  // Puntaje animado que se muestra en el cartel de ganador
  const puntajeGanadorAnimado = useCountUp(
    ganador && ganador !== 'empate' ? calcularTotal(ganador) : 0
  )

  // Si el competidor llegó a 9 puntos, queda como ganador
  const verificarGanadorPorPuntos = (competidor, estadoCompetidor) => {
    if (!ganador && calcularTotalDesde(estadoCompetidor) >= 9) {
      setGanador(competidor)
      setResultadoVisible(true)
    }
  }

  // Modificar puntos
  const modificarPunto = (competidor, tipo, valor) => {
    const nuevoValor = estado[competidor][tipo] + valor
    if (nuevoValor < 0) return

    const nuevoEstadoCompetidor = { ...estado[competidor], [tipo]: nuevoValor }
    setEstado((prev) => ({
      ...prev,
      [competidor]: nuevoEstadoCompetidor,
    }))
    verificarGanadorPorPuntos(competidor, nuevoEstadoCompetidor)
  }

  // Marcar/desmarcar una falta (permite seleccionar varias columnas por fila)
  const modificarFalta = (competidor, fila, columna) => {
    const oponente = oponenteDe(competidor)
    const yaMarcada = faltas[competidor][fila].includes(columna)
    const nuevasColumnas = yaMarcada
      ? faltas[competidor][fila].filter((c) => c !== columna)
      : [...faltas[competidor][fila], columna]

    setFaltas((prev) => ({
      ...prev,
      [competidor]: {
        ...prev[competidor],
        [fila]: nuevasColumnas,
      },
    }))

    const puntos = PUNTOS_POR_FALTA[columna] || 0
    if (puntos > 0) {
      const nuevoEstadoOponente = {
        ...estado[oponente],
        penalizacion: Math.max(
          0,
          estado[oponente].penalizacion + (yaMarcada ? -puntos : puntos)
        ),
      }
      setEstado((prev) => ({
        ...prev,
        [oponente]: nuevoEstadoOponente,
      }))
      verificarGanadorPorPuntos(oponente, nuevoEstadoOponente)
    }

    if (esFaltaGanadora(columna)) {
      setGanador(yaMarcada ? null : oponente)
      if (!yaMarcada) setResultadoVisible(true)
    }
  }

  // Marcar/desmarcar la salida de un competidor: el rival queda como ganador
  const modificarSalida = (competidor, motivo) => {
    if (salida?.competidor === competidor && salida.motivo === motivo) {
      setSalida(null)
      setGanador(null)
      return
    }
    setSalida({ competidor, motivo })
    setGanador(oponenteDe(competidor))
    setResultadoVisible(true)
    setTimerActive(false)
  }

  // Al agotarse el tiempo: gana quien tenga más puntos, o empate (Encho-Sen)
  const handleTimeUp = () => {
    if (ganador) return
    const totalShiro = calcularTotal('shiro')
    const totalAka = calcularTotal('aka')
    if (totalShiro > totalAka) setGanador('shiro')
    else if (totalAka > totalShiro) setGanador('aka')
    else setGanador('empate')
    setResultadoVisible(true)
  }

  // Iniciar el combate extra en caso de empate
  const iniciarEnchoSen = () => {
    setEstado({
      shiro: estadoVacio(),
      aka: estadoVacio(),
    })
    setFaltas({
      shiro: faltasVacias(),
      aka: faltasVacias(),
    })
    setGanador(null)
    setSalida(null)
    setEnchoSen(true)
    setTimerActive(false)
    setDuration(DURACION_ENCHO_SEN)
  }

  // Control de cronómetro
  const controlTimer = (accion) => {
    if (accion === 'start') {
      setTimerActive(true)
    } else if (accion === 'pause') {
      setTimerActive(false)
    } else if (accion === 'reset') {
      setTimerActive(false)
      setDuration(enchoSen ? DURACION_ENCHO_SEN : DURACION_COMBATE)
    }
  }

  // Atajos de teclado: Espacio = iniciar/pausar, R = reiniciar el cronómetro.
  // Se ignoran al escribir en un campo (nombres, categoría) y con Ctrl/Alt/Cmd
  // (por ejemplo Ctrl+R recarga la página).
  // El foco vive en el botón Iniciar/Pausar: al abrir la página y después de
  // tocar cualquier otro botón (puntos, faltas, etc.) vuelve ahí.
  const botonInicioRef = useRef(null)
  useEffect(() => {
    const enfocarInicio = () => botonInicioRef.current?.focus({ preventScroll: true })
    enfocarInicio()
    const onClick = (e) => {
      if (e.target instanceof Element && e.target.closest('button')) enfocarInicio()
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  const timerRef = useRef({ controlTimer, timerActive })
  useEffect(() => {
    timerRef.current = { controlTimer, timerActive }
  })
  useEffect(() => {
    if (modoKansa) return undefined // Kansa no tiene cronómetro
    const escribiendoEnCampo = (e) => {
      const t = e.target
      return (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
    }
    const atajoDe = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || escribiendoEnCampo(e)) return null
      if (e.code === 'Space') return 'alternar'
      if (e.key.toLowerCase() === 'r') return 'reset'
      return null
    }
    const onKeyDown = (e) => {
      const atajo = atajoDe(e)
      if (!atajo) return
      e.preventDefault() // evita el scroll de la página con Espacio
      if (e.repeat) return
      const { controlTimer: control, timerActive: activo } = timerRef.current
      control(atajo === 'alternar' ? (activo ? 'pause' : 'start') : 'reset')
    }
    // Si un botón tiene el foco, Espacio lo "clickearía" al soltar la tecla
    const onKeyUp = (e) => {
      if (e.code === 'Space' && atajoDe(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [modoKansa])

  const nombreResultado = (valor) => {
    if (valor === 'shiro') return nombreDe('shiro')
    if (valor === 'aka') return nombreDe('aka')
    return 'EMPATE'
  }

  // Deja el combate listo para uno nuevo (puntajes, faltas, nombres, timer y resultado)
  const resetCombate = () => {
    setEstado({
      shiro: estadoVacio(),
      aka: estadoVacio(),
    })
    setFaltas({
      shiro: faltasVacias(),
      aka: faltasVacias(),
    })
    setNombres({ shiro: '', aka: '' })
    setGanador(null)
    setSalida(null)
    setEnchoSen(false)
    setResultadoVisible(true)
    setTimerActive(false)
    setDuration(DURACION_COMBATE)
  }

  // Guardar el resultado del combate en el historial (sin reiniciar)
  const guardarEnHistorial = () => {
    // sin torneo abierto no se guarda nada (la base también lo rechaza)
    if (sinTorneo) {
      alert(MENSAJE_SIN_TORNEO)
      return
    }
    const shiroTotal = calcularTotal('shiro')
    const akaTotal = calcularTotal('aka')
    const resultado = nombreResultado(ganador)

    const payload = {
      categoria,
      nombreShiro: nombreDe('shiro'),
      nombreAka: nombreDe('aka'),
      shiroTotal,
      akaTotal,
      ganador: resultado,
      ladoGanador: ganador ?? 'empate',
    }

    console.log('Combate guardado:', payload)
    guardarResultado({
      modulo: 'kumite',
      payload: {
        ...payload,
        faltas,
        salida,
        enchoSen,
        duracionRestanteMs: duration,
        responsableMesa: leerResponsable().trim(),
        sistemaJueces,
        guardadoEn: new Date().toISOString(),
      },
    }).then((r) => {
      alert(
        `¡Combate Guardado!\n\nGanador: ${resultado}\nResultado: ${nombreDe('shiro')} ${shiroTotal} - ${nombreDe('aka')} ${akaTotal}\nCategoría: ${categoria}\n\n${mensajeGuardado(r)}`
      )
    })
  }

  // Reiniciar combate (botón CANCELAR, con confirmación)
  const nuevoCombate = () => {
    if (confirm('¿Seguro que querés iniciar un nuevo combate?')) {
      resetCombate()
    }
  }

  const reiniciarCombateCompleto = () => {
    if (confirm('¿Seguro que querés reiniciar el combate actual?')) {
      resetCombate()
    }
  }

  // Publica el marcador en vivo para la pantalla pública (segundo monitor)
  usePublishLive({
    tipo: 'kumite',
    categoria,
    duration,
    enchoSen,
    // el cartel de ganador se refleja en la pantalla pública mientras esté abierto
    ganador: ganador && ganador !== 'empate' && resultadoVisible ? ganador : null,
    shiro: { nombre: nombres.shiro.trim(), total: calcularTotal('shiro'), faltas: faltas.shiro },
    aka: { nombre: nombres.aka.trim(), total: calcularTotal('aka'), faltas: faltas.aka },
  }, !modoKansa)
  return (
    <>
      {!pantallaCompleta && <Header />}
      <main className="kumite-container" style={{ height: `calc(100dvh - ${alturaHeader}px)` }}>
        <button
          type="button"
          className="btn-display btn-pantalla-completa"
          onClick={alternarPantallaCompleta}
          title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
          aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {pantallaCompleta ? '⤡' : '⤢'}
        </button>

        {!modoKansa && (
          <button
            type="button"
            className="btn-display"
            onClick={openPublicDisplay}
            title="Abrir la pantalla pública para el segundo monitor"
          >
            🖥️ Pantalla pública
          </button>
        )}

        <div
          className="kumite-wrapper"
          ref={contentRef}
          style={{
            // al achicar el tablero se ensancha lo mismo para seguir ocupando todo el ancho
            width: `${100 / scale}%`,
            maxWidth: 'none',
            transform: `scale(${scale})`,
            // si se agranda, la caja queda centrada y crece desde el centro; si se achica, ocupa todo el ancho
            transformOrigin: scale >= 1 ? 'top center' : 'top left',
          }}
        >
          {/* Header del Kumite */}
          {!modoKansa && (
            <div className="kumite-header">
              <Timer
                duration={duration}
                setDuration={setDuration}
                timerActive={timerActive}
                controlTimer={controlTimer}
                onTimeUp={handleTimeUp}
              />
            </div>
          )}

          {/* Sección de Categoría y cronómetro (Kansa no la ve) */}
          {!modoKansa && (
          <div className="kumite-controls">
            <AreaField variante="campo" />
            <ResponsableField variante="campo" />
            <div className="categoria-field">
              <label>CATEGORÍA</label>
              <input
                type="text"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Nombre de la categoría"
              />
            </div>

            <div className="timer-buttons">
              {/* Un solo botón: inicia o pausa según el estado del cronómetro */}
              <button
                ref={botonInicioRef}
                onClick={() => controlTimer(timerActive ? 'pause' : 'start')}
                className={`btn-timer ${timerActive ? 'btn-pause' : 'btn-start'}`}
                title={timerActive ? 'Pausar (Espacio)' : 'Iniciar (Espacio)'}
              >
                {timerActive ? 'PAUSAR' : 'INICIAR'}
              </button>
              <button
                onClick={() => controlTimer('reset')}
                className="btn-timer btn-reset"
                title="Reiniciar (R)"
              >
                REINICIAR
              </button>
            </div>

            {enchoSen && <div className="encho-sen-badge">ENCHO-SEN</div>}
          </div>
          )}

          {/* Empate: se resuelve con un combate extra */}
          {ganador === 'empate' && (
            <div className="resultado-banner resultado-empate">
              <span>¡EMPATE! Se define en un combate extra.</span>
              <button className="btn-encho-sen" onClick={iniciarEnchoSen}>
                INICIAR ENCHO-SEN
              </button>
            </div>
          )}

          {/* Marcadores */}
          <div className="kumite-marcadores">
            <Marcador
              titulo="SHIRO (BLANCO)"
              tipo="shiro"
              puntos={estado.shiro}
              total={calcularTotal('shiro')}
              onModificar={modificarPunto}
              faltas={faltas.shiro}
              onFalta={modificarFalta}
              nombre={nombres.shiro}
              onNombreChange={cambiarNombre}
              salida={salida?.competidor === 'shiro' ? salida.motivo : null}
              onSalida={modificarSalida}
              mostrarNombre={!modoKansa}
              color="blue"
            />
            <Marcador
              titulo="AKA (ROJO)"
              tipo="aka"
              puntos={estado.aka}
              total={calcularTotal('aka')}
              onModificar={modificarPunto}
              faltas={faltas.aka}
              onFalta={modificarFalta}
              nombre={nombres.aka}
              onNombreChange={cambiarNombre}
              salida={salida?.competidor === 'aka' ? salida.motivo : null}
              onSalida={modificarSalida}
              mostrarNombre={!modoKansa}
              color="red"
            />
          </div>

          {/* Botones finales */}
          {/* En pantalla completa no se muestran Cancelar ni Nuevo combate */}
          {!pantallaCompleta && (
          <div className="kumite-footer">
            <button
              onClick={reiniciarCombateCompleto}
              className="btn-cancelar"
            >
              CANCELAR
            </button>
            <button
              onClick={nuevoCombate}
              className="btn-guardar"
            >
              NUEVO COMBATE
            </button>
          </div>
          )}
        </div>

        {/* Cartel de ganador */}
        {ganador && ganador !== 'empate' && resultadoVisible && (
          <div
            className="resultado-overlay"
            onClick={() => setResultadoVisible(false)}
          >
            <div
              className={`resultado-board ${ganador === 'shiro' ? 'marcador-blue' : 'marcador-red'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="resultado-close"
                onClick={() => setResultadoVisible(false)}
                aria-label="Cerrar"
              >
                &times;
              </button>

              <div className="resultado-ganador-label">🏆 GANADOR</div>
              <div className="resultado-nombre-badge">{nombreDe(ganador)}</div>

              <div className="resultado-cards">
                <div className="resultado-card">
                  <div className="resultado-card-icono">🏆</div>
                  <div className="resultado-card-label">Puntaje Final</div>
                  <div className="resultado-card-valor">{Math.round(puntajeGanadorAnimado)}</div>
                </div>
              </div>

              <p className="resultado-vs">
                vs {nombreDe(oponenteDe(ganador))}: {calcularTotal(oponenteDe(ganador))}
              </p>

              <div className="resultado-acciones">
                <button className="btn-save" onClick={guardarEnHistorial}>
                  💾 Guardar en Historial
                </button>
                <button className="btn-new" onClick={nuevoCombate}>
                  ➕ Nuevo Combate
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {!pantallaCompleta && <Footer />}
    </>
  )
}

export default Kumite;