import { useState } from 'react'
import { leerRanking, marcarCierre, resultadoDeCategoria } from '../lib/ranking'

// Lo que hace la mesa (Kata, Kobudo y Destreza) con el ranking al tocar sus botones.
//   avanzar()          sube el número de ronda
//   cerrarResultado()  cierra el cartel del resultado y deja el formulario vacío (pasa a "entre competidores")
//   cerrarCategoria()  termina la categoría: borra la ronda y los jueces
//
// Devuelve:
//   vista         lo que la mesa tiene que mostrar: null o { tipo: 'parcial' | 'ronda' | 'empate' | 'categoria', ranking }
//   verRanking()  "Ver ranking" mientras se arma (los 8 mejores)
//   siguienteRonda()   avanza la ronda y muestra los 8 mejores de la que terminó (también en la pantalla pública)
//   finalizar()        con empate en el podio no cierra: muestra el empate para desempatar. Si no, muestra el podio
//                      (3 mejores) y pide confirmar. Sin puntajes cargados, cierra la categoría directamente.
//   confirmarCategoria()  cierra la categoría; la pantalla pública sigue mostrando el podio hasta el próximo puntaje
//   cerrarVista()      cierra la ventana; si era el podio, la categoría sigue abierta
export default function useRankingMesa({ avanzar, cerrarResultado, cerrarCategoria }) {
  const [vista, setVista] = useState(null)

  const mostrar = (tipo, cierre) => {
    marcarCierre(cierre) // la pantalla pública lo muestra igual que la mesa
    setVista({ tipo, ranking: leerRanking() })
  }

  return {
    vista,
    hayRanking: leerRanking() !== null,
    verRanking: () => {
      const ranking = leerRanking()
      if (ranking) setVista({ tipo: 'parcial', ranking })
    },
    siguienteRonda: () => {
      const hayPuntajes = leerRanking() !== null
      avanzar()
      cerrarResultado()
      if (hayPuntajes) mostrar('ronda', 'ronda')
    },
    finalizar: () => {
      const { estado } = resultadoDeCategoria(leerRanking())
      if (estado === 'vacio') {
        cerrarCategoria()
        return
      }
      cerrarResultado() // sin el cartel del competidor, la pantalla pública muestra el ranking
      if (estado === 'empate') mostrar('empate', 'empate')
      else mostrar('categoria', 'categoria')
    },
    confirmarCategoria: () => {
      cerrarCategoria()
      setVista(null)
    },
    cerrarVista: () => {
      if (vista?.tipo === 'categoria') marcarCierre(null) // no se confirmó: la categoría sigue abierta
      setVista(null)
    },
  }
}
