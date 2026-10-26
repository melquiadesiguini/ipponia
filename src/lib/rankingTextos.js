import { etiquetaArea } from '../hooks/useArea'
import { puestosEmpatados } from './ranking'

// "Kata · Área N° 2 · Ronda 1"
export const tituloRanking = (ranking) =>
  [ranking.modulo, ranking.area && etiquetaArea(ranking.area), ranking.ronda != null && `Ronda ${ranking.ronda}`].filter(Boolean).join(' · ')

// Mensaje de empate para el pie: "Empate en el puesto 2: deben volver a pasar para desempatar"
export const mensajeEmpate = (filas) => {
  const puestos = puestosEmpatados(filas)
  if (puestos.length === 0) return null
  return `Empate en ${puestos.length === 1 ? 'el puesto' : 'los puestos'} ${puestos.join(' y ')}: deben volver a pasar para desempatar`
}
