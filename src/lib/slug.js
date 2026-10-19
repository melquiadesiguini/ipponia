// El identificador de una organización (slug) es la parte de la dirección donde entran sus usuarios:
//   .../ipponia/club-norte/ingresar
// Se genera solo a partir del nombre (sin tildes, en minúsculas y con guiones), con las mismas reglas que la base:
// de 3 a 40 caracteres, solo minúsculas, números y guiones, sin empezar ni terminar con guion, y sin palabras reservadas.

// Palabras que no pueden ser un identificador (son direcciones propias de la app). Mantener igual que
// `slugs_reservados()` en la migración 20261013120000 y que SLUGS_RESERVADOS en supabase/functions/_shared/validar.ts
export const SLUGS_RESERVADOS = [
  'kata', 'kumite', 'kobudo', 'destreza', 'pantalla', 'juez', 'jueces', 'cuenta', 'ingresar',
  'registro', 'restablecer', 'configuracion', 'historial', 'superadmin', 'admin', 'api',
  'assets', 'login', 'logout', 'torneos', 'www', 'ipponia', 'soporte', 'ayuda', 'docs', 'static',
]

export function slugDesdeNombre(nombre = '') {
  let base = String(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita las tildes (y la ñ queda como n)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) return ''
  if (base.length < 3) base += '-org'
  base = base.slice(0, 34).replace(/-+$/, '') // deja lugar para un sufijo (-2, -3…) si el nombre ya existe
  if (SLUGS_RESERVADOS.includes(base)) base += '-org'
  return base
}

// Variantes para cuando el identificador ya existe: club-norte, club-norte-2, club-norte-3…
export const conSufijo = (base, n) => (n <= 1 ? base : `${base}-${n}`)
