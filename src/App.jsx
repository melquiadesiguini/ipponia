import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom'
import AuthProvider from './context/AuthProvider'
import RutaProtegida from './components/RutaProtegida'
import RequierePermiso from './components/RequierePermiso'
import SincronizadorOffline from './components/EstadoConexion/SincronizadorOffline'
import AvisoActualizacion from './components/AvisoActualizacion/AvisoActualizacion'
import { PERMISOS_MODULO } from './lib/permisos'
import Home from './pages/Home'
import Kata from './pages/Kata'
import Kumite from './pages/Kumite'
import KumiteModo from './pages/KumiteModo'
import Kobudo from './pages/Kobudo'
import Destreza from './pages/Destreza'
import Pantalla from './pages/Pantalla'
import Ingresar from './pages/Ingresar'
import Restablecer from './pages/Restablecer'
import CambiarClave from './pages/CambiarClave'
import Cuenta from './pages/Cuenta'
import ConfigHistorial from './pages/ConfigHistorial'
import ConfigInicio from './pages/ConfigInicio'
import ConfigPersonas from './pages/ConfigPersonas'
import ConfigUsuarios from './pages/ConfigUsuarios'
import ConfigRoles from './pages/ConfigRoles'
import ConfigTorneos from './pages/ConfigTorneos'
import ConfigOrganizaciones from './pages/ConfigOrganizaciones'

// /nombre-de-la-organizacion → su pantalla de ingreso
function IrAIngresoDeOrganizacion() {
  const { slugOrg } = useParams()
  return <Navigate to={`/${slugOrg}/ingresar`} replace />
}

// Mesa y Kansa se abren con el sistema de jueces ya elegido (?jueces=3 o ?jueces=5); si falta, se vuelve a preguntar
function KumiteConSistema({ modoKansa = false }) {
  const [params] = useSearchParams()
  const sistema = Number(params.get('jueces'))
  if (sistema !== 3 && sistema !== 5) return <Navigate to="/kumite" replace />
  return <Kumite modoKansa={modoKansa} sistemaJueces={sistema} />
}

function App() {
  return (
    <AuthProvider>
      <SincronizadorOffline />
      <AvisoActualizacion />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Públicas */}
          <Route path="/pantalla" element={<Pantalla />} />
          <Route path="/ingresar" element={<Ingresar />} />
          <Route path="/restablecer" element={<Restablecer />} />

          {/* Con sesión */}
          <Route element={<RutaProtegida />}>
            <Route path="/" element={<Home />} />
            <Route path="/cuenta" element={<Cuenta />} />
            <Route path="/cambiar-clave" element={<CambiarClave />} />

            {/* Módulos de torneo: cada uno pide su permiso */}
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.kata} />}>
              <Route path="/kata" element={<Kata />} />
            </Route>
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.kumite} />}>
              <Route path="/kumite" element={<KumiteModo />} />
            </Route>
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.kumiteMesa} />}>
              <Route path="/kumite/mesa" element={<KumiteConSistema />} />
            </Route>
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.kumiteKansa} />}>
              <Route path="/kumite/kansa" element={<KumiteConSistema modoKansa />} />
            </Route>
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.kobudo} />}>
              <Route path="/kobudo" element={<Kobudo />} />
            </Route>
            <Route element={<RequierePermiso permisos={PERMISOS_MODULO.destreza} />}>
              <Route path="/destreza" element={<Destreza />} />
            </Route>

            {/* Configuración (cada pantalla verifica su permiso en ConfigPagina) */}
            <Route path="/historial" element={<Navigate to="/configuracion/historial" replace />} />
            <Route path="/configuracion" element={<ConfigInicio />} />
            <Route path="/configuracion/historial" element={<ConfigHistorial />} />
            <Route path="/configuracion/usuarios" element={<ConfigUsuarios />} />
            <Route path="/configuracion/roles" element={<ConfigRoles />} />
            <Route path="/configuracion/torneos" element={<ConfigTorneos />} />
            <Route path="/configuracion/organizaciones" element={<ConfigOrganizaciones />} />
            <Route
              path="/configuracion/jueces"
              element={<ConfigPersonas tabla="jueces" titulo="Jueces" permiso="gestionar_jueces" />}
            />
            <Route
              path="/configuracion/competidores"
              element={<ConfigPersonas tabla="competidores" titulo="Competidores" permiso="cargar_competidores" />}
            />
          </Route>

          {/* Ingreso por organización: va después de las rutas fijas, que tienen prioridad */}
          <Route path="/:slugOrg/ingresar" element={<Ingresar />} />
          <Route path="/:slugOrg" element={<IrAIngresoDeOrganizacion />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
