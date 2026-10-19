import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigurado, conRespaldoDeSesion } from '../lib/supabase'
import { esErrorDeRed } from '../lib/errores'
import { guardarDatosCuenta, leerDatosCuenta, olvidarDatosCuenta } from '../lib/datosOffline'
import { emailInterno, recordarOrganizacion } from '../lib/ingreso'
import { AuthContext } from './auth-context'

// Mensajes de Supabase traducidos para mostrar al usuario
function traducirError(error, credenciales = 'Email o contraseña incorrectos.') {
  const msg = (error?.message || '').toLowerCase()
  if (msg.includes('invalid login credentials')) return credenciales
  if (msg.includes('banned')) return 'Tu usuario está desactivado. Consultá con el administrador de tu organización.'
  if (msg.includes('email not confirmed')) return 'Falta confirmar tu email: revisá tu bandeja de entrada.'
  if (msg.includes('password should be at least') || msg.includes('weak_password')) {
    return 'La contraseña es demasiado débil: usá al menos 8 caracteres.'
  }
  if (msg.includes('same_password') || msg.includes('different from the old')) return 'La contraseña nueva tiene que ser distinta de la actual.'
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Demasiados intentos. Esperá unos minutos y volvé a probar.'
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) return 'El email no es válido.'
  if (msg.includes('failed to fetch')) return 'No se pudo conectar. Revisá tu conexión a internet.'
  if (msg.includes('session') && msg.includes('missing')) return 'El enlace venció. Pedí uno nuevo.'
  return error?.message || 'Ocurrió un error inesperado.'
}

const hoy = () => new Date().toLocaleDateString('en-CA') // AAAA-MM-DD en hora local

// Datos del usuario conectado: su perfil (con la organización), si es superadmin y sus permisos.
// Todo se lee con RLS: cada uno ve solo lo suyo.
async function cargarDatos(userId) {
  const [perfilRes, superRes, permisosRes] = await Promise.all([
    supabase
      .from('perfiles')
      .select(
        'nombre_usuario, nombre_visible, es_dueno, activo, debe_cambiar_clave, organizaciones(id, slug, nombre, plan, estado, vence_el)'
      )
      .eq('usuario_id', userId)
      .maybeSingle(),
    supabase.rpc('es_superadmin'),
    supabase.rpc('mis_permisos_todos'),
  ])
  if (perfilRes.error || superRes.error || permisosRes.error) {
    return { error: true, sinRed: [perfilRes.error, superRes.error, permisosRes.error].some(esErrorDeRed) }
  }

  const { organizaciones: organizacion = null, ...perfil } = perfilRes.data ?? {}
  return {
    error: false,
    perfil: perfilRes.data ? perfil : null,
    organizacion,
    esSuperAdmin: superRes.data === true,
    permisos: permisosRes.data ?? [],
  }
}

// Con conexión se leen y se guarda una copia; sin conexión se usa la última copia, así la app abre igual.
// (Los permisos de la copia pueden estar desactualizados: se renuevan apenas hay internet, y la base los exige al enviar.)
async function cargarDatosConRespaldo(userId) {
  const d = await cargarDatos(userId)
  if (!d.error) {
    guardarDatosCuenta(userId, d)
    return d
  }
  // solo se usa la copia si falló la conexión (un rechazo del servidor, como un token inválido, sigue siendo un error)
  const copia = d.sinRed ? leerDatosCuenta(userId) : null
  return copia ? { ...copia, error: false } : d
}

const SIN_DATOS = { userId: null, error: false, perfil: null, organizacion: null, esSuperAdmin: false, permisos: [] }

// Mantiene la sesión del usuario (Supabase Auth) y sus permisos disponibles para toda la app
function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(supabaseConfigurado)
  const [datos, setDatos] = useState(SIN_DATOS)

  useEffect(() => {
    if (!supabase) return undefined

    supabase.auth.getSession().then(({ data, error }) => {
      setSession(conRespaldoDeSesion(data.session, navigator.onLine === false || esErrorDeRed(error)))
      setCargando(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, nuevaSesion) => {
      // sin internet Supabase no puede renovar un token vencido y avisa "sin sesión": se conserva la guardada
      const sinRed = evento !== 'SIGNED_OUT' && (evento === 'INITIAL_SESSION' || navigator.onLine === false)
      setSession(conRespaldoDeSesion(nuevaSesion, sinRed))
    })

    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id ?? null

  const aplicar = useCallback(
    (d) => {
      setDatos({ ...SIN_DATOS, ...d, userId })
      if (d.organizacion?.slug) recordarOrganizacion(d.organizacion.slug)
    },
    [userId]
  )

  const recargar = useCallback(async () => {
    if (supabase && userId) aplicar(await cargarDatosConRespaldo(userId))
  }, [userId, aplicar])

  // Se piden una vez al iniciar sesión; "cargado" se deriva de `datos.userId` (ver más abajo)
  useEffect(() => {
    if (!supabase || !userId) return undefined
    let activo = true
    cargarDatosConRespaldo(userId).then((d) => activo && aplicar(d))
    return () => {
      activo = false
    }
  }, [userId, aplicar])

  const value = useMemo(() => {
    // Los datos solo valen si corresponden al usuario actual (evita mostrar los de una sesión anterior)
    const vigente = Boolean(userId) && datos.userId === userId
    const d = vigente ? datos : SIN_DATOS
    const permisos = d.permisos
    const conjunto = new Set(permisos.map((p) => p.permiso))
    const puede = (permiso) => !supabaseConfigurado || conjunto.has(permiso)
    const puedeAlguno = (lista) => lista.some(puede)

    const org = d.organizacion
    const organizacionVigente = Boolean(org) && ['prueba', 'activa'].includes(org.estado) && (!org.vence_el || org.vence_el >= hoy())

    return {
      configurado: supabaseConfigurado,
      cargando,
      user: session?.user ?? null,
      perfil: d.perfil,
      organizacion: org,
      organizacionVigente,
      esSuperAdmin: d.esSuperAdmin,
      permisos,
      perfilCargado: vigente,
      errorCarga: vigente && d.error,
      puede,
      puedeAlguno,
      puedeVerHistorial: puede('ver_historial'),
      esAdmin: puede('gestionar_usuarios'),
      recargar,

      // Usuario interno: nombre de usuario + contraseña; la organización la da la dirección
      async iniciarSesionUsuario(slug, usuario, password) {
        const email = emailInterno(usuario, slug)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return { ok: false, mensaje: traducirError(error, 'Usuario o contraseña incorrectos.') }
        recordarOrganizacion(slug.trim().toLowerCase())
        return { ok: true }
      },

      // Dueño de la organización y superadmin: entran con su email real
      async iniciarSesionEmail(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        return error ? { ok: false, mensaje: traducirError(error) } : { ok: true }
      },

      // Envía el email para elegir una contraseña nueva (solo cuentas con email real)
      async pedirRecuperacion(email) {
        const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}restablecer`
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        return error ? { ok: false, mensaje: traducirError(error) } : { ok: true }
      },

      // Cambia la contraseña del usuario conectado (también sirve para el cambio obligatorio inicial)
      async cambiarClave(nueva) {
        const { error } = await supabase.auth.updateUser({ password: nueva })
        if (error) return { ok: false, mensaje: traducirError(error) }
        const { error: errorMarca } = await supabase.rpc('marcar_clave_cambiada')
        if (errorMarca) return { ok: false, mensaje: 'Se cambió la contraseña, pero no se pudo actualizar tu cuenta. Volvé a ingresar.' }
        await recargar()
        return { ok: true }
      },

      async cerrarSesion() {
        olvidarDatosCuenta()
        await supabase.auth.signOut()
      },
    }
  }, [session, cargando, datos, userId, recargar])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
