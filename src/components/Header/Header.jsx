import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import logoClaro from '../../assets/images/ipponia-logo.png' // cinturón negro (tema claro)
import logoOscuro from '../../assets/images/ipponia-logo-oscuro.png' // cinturón blanco (tema oscuro)
import useTheme from '../../hooks/useTheme'
import useAuth from '../../hooks/useAuth'
import EstadoConexion from '../EstadoConexion/EstadoConexion'
import { PERMISOS_MODULO, seccionesVisibles } from '../../lib/permisos'
import s from './Header.module.css'

function Header() {
  const { theme, toggleTheme } = useTheme()
  const { user, perfil, esSuperAdmin, puede, puedeAlguno } = useAuth()
  const seccionesConfig = seccionesVisibles({ esSuperAdmin, puede })
  const hayConfiguracion = seccionesConfig.length > 0
  const nombreCuenta = perfil?.nombre_visible || perfil?.nombre_usuario || user?.email
  const [menuAbierto, setMenuAbierto] = useState(false)
  const menuRef = useRef(null)
  // En tablet y celular el menú se contrae detrás de un botón
  // (se guarda en qué página se abrió: al navegar a otra, vuelve a quedar contraído)
  const [abiertaEn, setAbiertaEn] = useState(null)
  const { pathname } = useLocation()
  const navAbierta = abiertaEn === pathname

  // Cierra el menú al tocar fuera de él o con Escape
  useEffect(() => {
    if (!menuAbierto) return undefined
    const cerrar = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !menuRef.current?.contains(e.target)) setMenuAbierto(false)
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', cerrar)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('keydown', cerrar)
    }
  }, [menuAbierto])

  return (
    <header>
      <div className={`${s.headerContent}`}>
        <Link to="/" className={s.brand} aria-label="IPPONIA, ir al inicio">
          <img
            src={theme === 'dark' ? logoOscuro : logoClaro}
            alt=""
            className={s.logoImg}
          />
          <h1 className={s.logo}>IPPONIA</h1>
        </Link>
        {user && <EstadoConexion />}
        <button
          type="button"
          className={s.hamburguesa}
          onClick={() => setAbiertaEn(navAbierta ? null : pathname)}
          aria-expanded={navAbierta}
          aria-controls="menu-principal"
          aria-label={navAbierta ? 'Cerrar el menú' : 'Abrir el menú'}
        >
          {navAbierta ? '✕' : '☰'}
        </button>
        <div className={`${s.headerContent2} ${navAbierta ? s.navAbierta : ''}`} id="menu-principal">
          <nav className={s.containerNav}>
            <div className={s.containerNav2}>
              <Link to="/">Home</Link>
              {puedeAlguno(PERMISOS_MODULO.kata) && <Link to="/kata">Kata</Link>}
              {puedeAlguno(PERMISOS_MODULO.kumite) && <Link to="/kumite">Kumite</Link>}
              {puedeAlguno(PERMISOS_MODULO.kobudo) && <Link to="/kobudo">Kobudo</Link>}
              {puedeAlguno(PERMISOS_MODULO.destreza) && <Link to="/destreza">Destreza</Link>}
              {user ? (
                <div
                  className={s.menuConfig}
                  ref={menuRef}
                  onMouseEnter={() => setMenuAbierto(true)}
                  onMouseLeave={() => setMenuAbierto(false)}
                >
                  <Link to="/cuenta" title={nombreCuenta} aria-haspopup={hayConfiguracion ? 'menu' : undefined}>
                    Mi cuenta
                  </Link>
                  {menuAbierto && hayConfiguracion && (
                    <div className={s.menuConfigLista} role="menu" onClick={() => setMenuAbierto(false)}>
                      <div className={s.menuConfigCaja}>
                        <span className={s.menuConfigTitulo}>Configuración</span>
                        {seccionesConfig.map((sec) => (
                          <Link key={sec.a} to={sec.a} role="menuitem">
                            {sec.texto}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link to="/ingresar" title="Ingresar">
                  Ingresar
                </Link>
              )}
              <button
                type="button"
                className={s.themeToggle}
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
                title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
            </div>
          </nav>
        </div>
      </div>
    </header>
  )
}

export default Header