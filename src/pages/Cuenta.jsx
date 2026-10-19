import { Link } from 'react-router-dom'
import Header from '../components/Header/Header'
import Footer from '../components/Footer/Footer'
import InstalarApp from '../components/InstalarApp/InstalarApp'
import useAuth from '../hooks/useAuth'
import { PERMISOS, seccionesVisibles } from '../lib/permisos'
import './Cuenta.css'

// Datos de la cuenta del usuario conectado (se llega con sesión iniciada: ver RutaProtegida)
function Cuenta() {
  const { configurado, user, perfil, organizacion: org, esSuperAdmin, permisos, puede, cerrarSesion } = useAuth()

  const seccionesConfig = seccionesVisibles({ esSuperAdmin, puede })
  const nombresPermisos = [...new Set(permisos.map((p) => p.permiso))].map((p) => PERMISOS[p] ?? p)
  const identificador = perfil?.nombre_usuario ?? user?.email

  let contenido
  if (!configurado) {
    contenido = (
      <p className="cuenta-nota">
        La conexión con la base de datos no está configurada en esta versión, por eso las cuentas no están
        disponibles. Los resultados se guardan solo en este navegador.
      </p>
    )
  } else {
    contenido = (
      <>
        <p className="cuenta-dato">
          Sesión iniciada como <strong>{perfil?.nombre_visible || identificador}</strong>
          {perfil?.nombre_visible && perfil?.nombre_usuario ? ` (${perfil.nombre_usuario})` : ''}
        </p>
        {esSuperAdmin && (
          <p className="cuenta-dato">
            Rol en la plataforma: <strong>Superadministrador</strong>
          </p>
        )}
        {org && (
          <p className="cuenta-dato">
            Organización: <strong>{org.nombre}</strong> · Plan: <strong>{org.plan}</strong>
            {org.vence_el ? ` · vence el ${new Date(`${org.vence_el}T00:00:00`).toLocaleDateString('es-AR')}` : ''}
          </p>
        )}
        {nombresPermisos.length > 0 && (
          <div className="cuenta-dato">
            Lo que podés hacer:
            <ul className="cuenta-lista">
              {nombresPermisos.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {org && nombresPermisos.length === 0 && (
          <p className="cuenta-nota">Todavía no tenés permisos asignados. Pedile al administrador que te asigne un rol.</p>
        )}
        <p className="cuenta-nota">Los resultados que guardes se almacenan en la nube, en tu organización.</p>
        <InstalarApp />
        <div className="cuenta-acciones">
          {seccionesConfig.length > 0 && (
            <Link to="/configuracion" className="cuenta-boton cuenta-boton-primario">
              Configuración
            </Link>
          )}
          <Link to="/cambiar-clave" className="cuenta-boton">
            Cambiar contraseña
          </Link>
          <button type="button" className="cuenta-boton" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="pagina-columna">
      <Header />
      <main className="cuenta-container">
        <section className="cuenta-card">
          <h1>Mi cuenta</h1>
          {contenido}
        </section>
      </main>
      <Footer />
    </div>
  )
}

export default Cuenta
