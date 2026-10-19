// Copia en este dispositivo de lo que la app necesita para abrir sin internet:
// los datos de la cuenta (perfil, organización y permisos) y el torneo abierto.
// Se actualiza cada vez que hay conexión; sin conexión se usa la última copia.
// Es solo una ayuda para la pantalla: lo que protege los datos sigue siendo la base (RLS) al enviar.

const CLAVE_CUENTA = 'tm-datos-cuenta'
const CLAVE_TORNEO = 'tm-torneo-abierto'

const guardar = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // sin almacenamiento disponible: se sigue sin copia
  }
}
const leer = (clave) => {
  try {
    return JSON.parse(localStorage.getItem(clave))
  } catch {
    return null
  }
}

export function guardarDatosCuenta(userId, datos) {
  guardar(CLAVE_CUENTA, { userId, datos })
}

export function leerDatosCuenta(userId) {
  const copia = leer(CLAVE_CUENTA)
  return copia?.userId === userId ? copia.datos : null
}

// Al cerrar sesión se borra la copia de la cuenta (la cola de resultados pendientes no se toca)
export function olvidarDatosCuenta() {
  try {
    localStorage.removeItem(CLAVE_CUENTA)
    localStorage.removeItem(CLAVE_TORNEO)
  } catch {
    // nada que borrar
  }
}

// torneo: { id, nombre } o null si no hay uno abierto
export function guardarTorneoAbierto(organizacionId, torneo) {
  guardar(CLAVE_TORNEO, { organizacionId, torneo })
}

export function leerTorneoAbierto(organizacionId) {
  const copia = leer(CLAVE_TORNEO)
  return copia && copia.organizacionId === organizacionId ? copia.torneo : null
}
