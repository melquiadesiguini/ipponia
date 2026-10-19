// Copia un texto al portapapeles. Devuelve true si se pudo.
// Usa la API moderna y, si el navegador no la ofrece (o la bloquea), el método clásico.
export async function copiarTexto(texto) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // se prueba el método clásico
  }
  try {
    const area = document.createElement('textarea')
    area.value = texto
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
