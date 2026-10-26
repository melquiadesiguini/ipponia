import { useRef, useState } from 'react'
import Header from '../components/Header/Header'
import Footer from '../components/Footer/Footer'
import AreaField from '../components/AreaField/AreaField'
import ResponsableField from '../components/ResponsableField/ResponsableField'
import RondaField from '../components/RondaField/RondaField'
import AutocompletarJuez from '../components/AutocompletarJuez/AutocompletarJuez'
import { useJueces } from '../lib/jueces'
import { armarJueces, numeroONull, puntajesNumericos } from '../lib/jurado'
import { readArea } from '../hooks/useArea'
import { leerResponsable } from '../hooks/useResponsableMesa'
import useTorneoAbierto, { MENSAJE_SIN_TORNEO } from '../hooks/useTorneoAbierto'
import { readRonda, avanzarRonda, limpiarRonda } from '../hooks/useRonda'
import { guardarResultado, mensajeGuardado } from '../lib/resultados'
import useCountUp from '../hooks/useCountUp'
import useFullscreen from '../hooks/useFullscreen'
import useFitToScreen from '../hooks/useFitToScreen'
import { usePublishResult, openPublicDisplay } from '../hooks/usePublicDisplay'
import { registrarEnRanking } from '../lib/ranking'
import useRankingMesa from '../hooks/useRankingMesa'
import { RankingMesa } from '../components/Ranking/Ranking'
import './Kata.css'

function Kata() {
  const containerRef = useRef(null)
  const { isFullscreen } = useFullscreen(containerRef)
  const { contentRef, scale } = useFitToScreen(isFullscreen)

  const [judgeSystem, setJudgeSystem] = useState(null)
  const [kata, setKata] = useState('')
  const [competitor, setCompetitor] = useState('')
  const [scores, setScores] = useState({
    judge1: '',
    judge2: '',
    judge3: '',
    judge4: '',
    judge5: ''
  })
  // Nombres de los jueces: se conservan entre competidores (el panel de jueces suele ser el mismo)
  const [judgeNames, setJudgeNames] = useState({ judge1: '', judge2: '', judge3: '', judge4: '', judge5: '' })
  const { sugerencias: juecesSugeridos, buscar: buscarJueces, registrar: registrarJueces } = useJueces()
  const { sinTorneo } = useTorneoAbierto()
  const [errors, setErrors] = useState('')
  const [success, setSuccess] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [estadoGuardado, setEstadoGuardado] = useState('')
  const ultimoGuardado = useRef('') // firma del último resultado guardado
 
  const handleScoreChange = (judgeId, value) => {
    setScores(prev => ({
      ...prev,
      [judgeId]: value
    }))
  }
 
  // ✅ FUNCIÓN 1: SIN ORDENAR - Para mostrar en el orden original
  const getFilledScoresInOrder = () => {
    let judgeIds = judgeSystem === 3 
      ? ['judge1', 'judge2', 'judge3']
      : ['judge1', 'judge2', 'judge3', 'judge4', 'judge5']
    
    return judgeIds
      .map(id => ({
        judgeId: id,
        judgeNumber: parseInt(id.replace('judge', '')),
        score: scores[id] !== '' ? Number(scores[id]) : null
      }))
      .filter(item => item.score !== null)
      // NO ORDENA - mantiene el orden de ingreso
  }
 
  // ✅ FUNCIÓN 2: ORDENADA - Para los cálculos (mayor, menor, puntaje final)
  const getFilledScoresSorted = () => {
    return getFilledScoresInOrder()
      .slice() // Copia el array
      .sort((a, b) => b.score - a.score) // Ordena de mayor a menor
  }
 
  // Para usar en cálculos
  const getFilledScores = () => {
    return getFilledScoresSorted().map(item => item.score)
  }
 
  // Calcular el mayor
  const getHighest = () => {
    const filled = getFilledScores()
    return filled.length > 0 ? filled[0] : 0
  }
 
  // Calcular el menor
  const getLowest = () => {
    const filled = getFilledScores()
    return filled.length > 0 ? filled[filled.length - 1] : 0
  }
 
  // Calcular el puntaje final
  const getFinalScore = () => {
    const filled = getFilledScores()
    
    if (filled.length < judgeSystem) {
      return 0
    }
    
    if (judgeSystem === 3) {
      return filled.reduce((a, b) => a + b, 0).toFixed(2)
    }
    
    if (judgeSystem === 5) {
      const middle = filled.slice(1, filled.length - 1)
      return middle.reduce((a, b) => a + b, 0).toFixed(2)
    }
  }
 
  // Valores animados (cuentan hacia arriba/abajo cuando cambian)
  const finalScoreAnimado = useCountUp(showResults ? Number(getFinalScore()) : 0)

  // ✅ NUEVA: Determinar si un puntaje está incluido basándose en el puntaje
  const isScoreIncluded = (judgeId) => {
    if (judgeSystem === 3) {
      return true // En sistema de 3, todos están incluidos
    }

    // En sistema de 5 se descartan el mayor y el menor (uno de cada uno,
    // igual que el cálculo del puntaje final)
    const sorted = getFilledScoresSorted()
    if (sorted.length < 3) return true
    return judgeId !== sorted[0].judgeId && judgeId !== sorted[sorted.length - 1].judgeId
  }
 
  const validateForm = () => {
    if (!judgeSystem) {
      setErrors('❌ Debes seleccionar el sistema de jueces')
      return false
    }
    if (!competitor.trim()) {
      setErrors('❌ El nombre del competidor es requerido')
      return false
    }
    
    const filledScores = getFilledScores()
    if (filledScores.length === 0) {
      setErrors(`❌ Al menos ${judgeSystem} juez/jueces debe(n) calificar`)
      return false
    }
    
    if (filledScores.length < judgeSystem) {
      setErrors(`❌ Se requieren ${judgeSystem} calificaciones para calcular el puntaje`)
      return false
    }
    
    const validScores = Object.values(scores).every(s => {
      if (s === '') return true
      const num = Number(s)
      return num >= 0 && num <= 10
    })
    
    if (!validScores) {
      setErrors('❌ Las calificaciones deben estar entre 0 y 10')
      return false
    }
    
    setErrors('')
    return true
  }
 
  const handleFinalize = () => {
    // sin torneo abierto no se carga nada (la base también lo rechaza)
    if (sinTorneo) {
      setErrors('❌ ' + MENSAJE_SIN_TORNEO)
      return
    }
    if (!validateForm()) return
    
    setShowResults(true)
    guardarAutomatico()
    setSuccess('✅ ¡Cálculo realizado!')
    
    setTimeout(() => {
      setSuccess('')
    }, 3000)
  }
 
  // El resultado se guarda siempre, apenas se calcula: en el navegador y en la nube. No hace falta ningún botón.
  const guardarAutomatico = () => {
    const data = {
      judgeSystem,
      kata,
      competitor,
      scores: puntajesNumericos(scores),
      judgeNames,
      highest: getHighest(),
      lowest: getLowest(),
      finalScore: numeroONull(getFinalScore()),
      timestamp: new Date().toLocaleString('es-AR'),
      guardadoEn: new Date().toISOString(),
      area: numeroONull(readArea()),
      ronda: numeroONull(readRonda()),
      responsableMesa: leerResponsable().trim(),
      jueces: armarJueces({
        puntajes: getFilledScoresInOrder(),
        nombres: judgeNames,
        sistema: judgeSystem,
        incluido: isScoreIncluded,
      }),
    }

    // si se vuelve a pulsar FINALIZAR sin cambiar nada, no se guarda dos veces
    const firma = JSON.stringify([data.judgeSystem, data.ronda, data.competitor, data.kata, data.scores, data.judgeNames])
    if (ultimoGuardado.current === firma) return
    ultimoGuardado.current = firma

    registrarJueces(
      Object.entries(judgeNames)
        .filter(([id]) => Number(id.slice(5)) <= judgeSystem)
        .map(([, nombre]) => nombre)
    )

    const savedCompetitions = JSON.parse(localStorage.getItem('competitions')) || []
    savedCompetitions.push(data)
    localStorage.setItem('competitions', JSON.stringify(savedCompetitions))

    // suma el resultado al ranking de la pantalla pública (se ve entre competidores)
    registrarEnRanking({ modulo: 'Kata', area: data.area, ronda: data.ronda, competidor: data.competitor ?? competitor, kata: data.kata ?? null, puntaje: data.finalScore, sistema: data.judgeSystem, menor: data.lowest, mayor: data.highest })

    setEstadoGuardado('Guardando…')
    guardarResultado({ modulo: 'kata', payload: data }).then((r) => {
      setEstadoGuardado(r.ok ? 'Resultado guardado en la nube.' : mensajeGuardado(r))
    })
  }

  // Cierra el cartel y deja el formulario listo para el próximo competidor (los jueces siguen cargados)
  const siguienteCompetidor = () => {
    resetForm()
    setShowResults(false)
  }

  // Pasa a la ronda siguiente con los mismos jueces: sube el número de ronda y queda listo el próximo competidor
  const cerrarResultado = () => {
    resetForm()
    setShowResults(false)
  }

  // Termina la categoría: se borran la ronda y los jueces, y se vuelve a elegir el sistema de jueces
  const cerrarCategoria = () => {
    limpiarRonda()
    setJudgeNames({ judge1: '', judge2: '', judge3: '', judge4: '', judge5: '' })
    changeJudgeSystem(null)
  }

  // Ranking de la mesa: "Siguiente ronda" muestra los 8 mejores; "Finalizar categoría" muestra el podio (o el empate a resolver)
  const rankingMesa = useRankingMesa({ avanzar: avanzarRonda, cerrarResultado, cerrarCategoria })
  const siguienteRonda = rankingMesa.siguienteRonda
  const finalizarCategoria = rankingMesa.finalizar

  const resetForm = () => {
    ultimoGuardado.current = ''
    setEstadoGuardado('')
    setKata('')
    setCompetitor('')
    setScores({
      judge1: '',
      judge2: '',
      judge3: '',
      judge4: '',
      judge5: ''
    })
    setErrors('')
    setSuccess('')
  }
 
  const changeJudgeSystem = (system) => {
    setJudgeSystem(system)
    resetForm()
    setShowResults(false)
  }
 
  // Publica el resultado en la pantalla pública (segundo monitor)
  usePublishResult(showResults, () => ({
    modulo: 'Kata',
    competitor,
    finalScore: String(getFinalScore()),
    scores: getFilledScoresInOrder().map((item) => ({
      label: `Juez ${(item.judgeNumber === 3 && judgeSystem === 3) || (item.judgeNumber === 5 && judgeSystem === 5) ? 'Central' : `Nº${item.judgeNumber}`}`,
      score: item.score,
      included: isScoreIncluded(item.judgeId),
    })),
  }))

  return (
    <>
      <Header />
      <main className="kata-container" ref={containerRef}>
        <button
          type="button"
          className="btn-display"
          onClick={openPublicDisplay}
          title="Abrir la pantalla pública para el segundo monitor"
        >
          🖥️ Pantalla pública
        </button>

        {/* Mientras se arma el ranking, la mesa puede verlo cuando quiera (los 8 mejores) */}
        {rankingMesa.hayRanking && (
          <button
            type="button"
            className="btn-display btn-ver-ranking"
            onClick={rankingMesa.verRanking}
            title="Ver el ranking de la ronda (los 8 mejores)"
          >
            🏆 Ranking
          </button>
        )}

        <RankingMesa vista={rankingMesa.vista} onCerrar={rankingMesa.cerrarVista} onConfirmar={rankingMesa.confirmarCategoria} />

        <div
          className="kata-content"
          ref={contentRef}
          style={isFullscreen ? { transform: `scale(${scale})`, transformOrigin: 'top center' } : undefined}
        >
        {errors && <div className="error-message">{errors}</div>}
        {success && <div className="success-message">{success}</div>}
        
        {!judgeSystem ? (
          <div className="judge-system-selector">
            <h2>Selecciona el Sistema de Jueces</h2>
            <div className="system-buttons">
              <button 
                className="system-btn judges-3"
                onClick={() => changeJudgeSystem(3)}
              >
                <div className="system-icon">👥</div>
                <div className="system-title">3 Jueces</div>
                <div className="system-desc">Suma directa de 3 puntajes</div>
              </button>
              
              <button 
                className="system-btn judges-5"
                onClick={() => changeJudgeSystem(5)}
              >
                <div className="system-icon">👥👥</div>
                <div className="system-title">5 Jueces</div>
                <div className="system-desc">Suma de 3 puntajes centrales</div>
              </button>
            </div>
          </div>
        ) : (
          <>
            <button 
              className="btn-change-system"
              onClick={() => changeJudgeSystem(null)}
            >
              ← Volver
            </button>
 
            <div className="header-section">
              <div className="input-group">
                <h2>Competidor</h2>
                <input
                  type="text"
                  value={competitor}
                  onChange={(e) => setCompetitor(e.target.value)}
                  placeholder="Nombre del competidor"
                />
              </div>
              <div className="input-group">
                <h2>Kata</h2>
                <input
                  type="text"
                  value={kata}
                  onChange={(e) => setKata(e.target.value)}
                  placeholder="Nombre del kata"
                />
              </div>
              <AreaField />
              <RondaField />
            </div>
 
            <h3 className="data-entry-title">Entrada de Datos</h3>

            <ResponsableField />
 


            <table className="judges-table">
              <thead>
                <tr>
                  {(judgeSystem === 3
                    ? ['judge1', 'judge2', 'judge3']
                    : ['judge1', 'judge2', 'judge3', 'judge4', 'judge5']
                  ).map((judgeId) => (
                    <th key={judgeId}>
                      <span className="judge-th-label">
                        Juez {Number(judgeId.slice(5)) === judgeSystem ? 'Central' : `Nº${judgeId.slice(5)}`}
                      </span>
                      <AutocompletarJuez
                        value={judgeNames[judgeId]}
                        onChange={(nombre) => setJudgeNames((prev) => ({ ...prev, [judgeId]: nombre }))}
                        onBuscar={buscarJueces}
                        sugerencias={juecesSugeridos}
                        placeholder="Nombre del juez"
                        ariaLabel={`Nombre del juez ${judgeId.slice(5)}`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {judgeSystem === 3 ? (
                    ['judge1', 'judge2', 'judge3'].map(judgeId => (
                      <td key={judgeId}>
                        <input
                          type="number"
                          min="5"
                          max="8"
                          step="0.1"
                          value={scores[judgeId]}
                          onChange={(e) => handleScoreChange(judgeId, e.target.value)}
                          placeholder="0.0"
                        />
                      </td>
                    ))
                  ) : (
                    ['judge1', 'judge2', 'judge3', 'judge4', 'judge5'].map(judgeId => (
                      <td key={judgeId}>
                        <input
                          type="number"
                          min="5"
                          max="8"
                          step="0.1"
                          value={scores[judgeId]}
                          onChange={(e) => handleScoreChange(judgeId, e.target.value)}
                          placeholder="0.0"
                        />
                      </td>
                    ))
                  )}
                </tr>
              </tbody>
            </table>
 
            <button className="btn-finalize" onClick={handleFinalize}>
              OBTENER PUNTAJE
            </button>
          </>
        )}
        </div>

        {showResults && (
              <div className="results-overlay" onClick={() => setShowResults(false)}>
                <div className="results-board" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="results-close"
                  onClick={() => setShowResults(false)}
                  aria-label="Cerrar"
                >
                  &times;
                </button>

                <div className="system-badge">
                  {competitor}
                </div>
 
                <div className="results-grid">
                  <div className="result-card final">
                    <div className="result-icon">🏆</div>
                    <div className="result-label">Puntaje Final</div>
                    <div className="result-value-final">{finalScoreAnimado.toFixed(2)}</div>
                  </div>
                </div>
 
                <div className="results-detail">
                  <h3>Detalles de Calificaciones</h3>
                  <div className="scores-breakdown">
                    {getFilledScoresInOrder().map((item, idx) => (
                      <div 
                        key={idx} 
                        className={`score-item ${isScoreIncluded(item.judgeId) ? 'included' : 'discarded'}`}
                      >
                        <span className="score-position">
                          {isScoreIncluded(item.judgeId) ? '✅' : '❌'}
                        </span>
                        <span className="score-value">{item.score.toFixed(1)}</span>
                        <span className="judge-label">
                          Juez {item.judgeNumber === 3 && judgeSystem === 3 ? 'Central' : item.judgeNumber === 5 && judgeSystem === 5 ? 'Central' : `Nº${item.judgeNumber}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
 
                <div className="results-actions">
                  <button className="btn-categoria" onClick={finalizarCategoria}>
                    Finalizar categoría
                  </button>
                  <button className="btn-ronda" onClick={siguienteRonda}>
                    Siguiente ronda
                  </button>
                  <button className="btn-siguiente" onClick={siguienteCompetidor}>
                    Siguiente competidor
                  </button>
                </div>
                {estadoGuardado && (
                  <p className="results-guardado" role="status">
                    {estadoGuardado}
                  </p>
                )}
                </div>
              </div>
            )}
      </main>
      <Footer />
    </>
  )
}
 
export default Kata