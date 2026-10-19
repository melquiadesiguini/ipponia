// ¿El error es de conexión (no hay internet, o el servidor no responde) y no una respuesta de la base?
// Los errores de la base traen siempre un `code`; los de red no.
export function esErrorDeRed(error) {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true
  if (error.code) return false
  const texto = String(error.message ?? error).toLowerCase()
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timeout|aborted/.test(texto)
}

// Traduce un error de la base de datos a un mensaje para el usuario.
//   23505  dato repetido           42501  sin permiso (RLS)
//   P0001  regla propia de la base (los candados de la migración): su mensaje ya está en español
export function mensajeDe(error, duplicado = 'Ya existe uno con ese nombre.') {
  if (error?.code === '23505') return duplicado
  if (error?.code === '42501') return 'No tenés permiso para hacer esto.'
  if (error?.code === 'P0001' && error.message) return error.message
  if (error?.code === '23514') return 'Alguno de los datos no es válido.'
  if ((error?.message || '').toLowerCase().includes('failed to fetch')) return 'No se pudo conectar. Revisá tu conexión a internet.'
  return 'No se pudo guardar. Probá de nuevo.'
}
