import { useEffect, useState } from 'react'

// Alto en px del encabezado fijo de la página (cambia si el menú se acomoda en dos líneas).
// Con `visible` en false (pantalla completa) no hay encabezado y el alto es 0.
export default function useAlturaHeader(visible = true) {
  const [alto, setAlto] = useState(0)

  useEffect(() => {
    if (!visible) return undefined
    const header = document.querySelector('header')
    if (!header) return undefined
    const medir = () => setAlto(Math.ceil(header.getBoundingClientRect().height))
    medir()
    window.addEventListener('resize', medir)
    const observer = window.ResizeObserver ? new ResizeObserver(medir) : null
    observer?.observe(header)
    return () => {
      window.removeEventListener('resize', medir)
      observer?.disconnect()
    }
  }, [visible])

  return visible ? alto : 0
}
