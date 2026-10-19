import { useEffect, useMemo, useState } from 'react'
import useAuth from '../hooks/useAuth'
import ConfigPagina from './ConfigPagina'
import { actualizarOrganizacion, crearOrganizacion, ESTADOS_ORGANIZACION, listarOrganizaciones, urlIngreso } from '../lib/organizaciones'
import { generarClave } from '../lib/usuarios'
import { mensajeParaCliente } from '../lib/mensajeCliente'
import { slugDesdeNombre } from '../lib/slug'
import { copiarTexto } from '../lib/portapapeles'

const NUEVA_VACIA = { nombre: '', email_dueno: '', clave: '', vence_el: '' }
const fechaLegible = (f) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString('es-AR') : 'Sin vencimiento')

// Clientes de la plataforma (solo superadmin): alta, estado, vencimiento y notas.
function ConfigOrganizaciones() {
  const { user, esSuperAdmin } = useAuth()
  const [filas, setFilas] = useState([])
  const [cargandoLista, setCargandoLista] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [panel, setPanel] = useState(null) // { tipo: 'nueva', valores } | { tipo: 'editar', id, nombreOriginal, valores }
  const [entrega, setEntrega] = useState(null) // datos para pasarle al cliente tras el alta
  const [entregaCopiada, setEntregaCopiada] = useState(false)
  const [copiada, setCopiada] = useState(null) // id de la organización cuyos datos se acaban de copiar
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')

  const recargar = () => listarOrganizaciones().then((r) => setFilas(r.filas))

  useEffect(() => {
    if (!user || !esSuperAdmin) return undefined
    let activo = true
    listarOrganizaciones().then((r) => {
      if (!activo) return
      setFilas(r.filas)
      setCargandoLista(false)
    })
    return () => {
      activo = false
    }
  }, [user, esSuperAdmin])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? filas.filter((o) => [o.nombre, o.slug].some((v) => v.toLowerCase().includes(q))) : filas
  }, [filas, busqueda])

  const cambiar = (campo, valor) => setPanel({ ...panel, valores: { ...panel.valores, [campo]: valor } })

  const urlDueno = `${window.location.origin}${import.meta.env.BASE_URL}ingresar`

  // Datos de la organización recién creada, para pasarle al dueño (con su contraseña, que no se vuelve a mostrar)
  const copiarEntrega = async () => {
    const ok = await copiarTexto(
      mensajeParaCliente({ nombre: entrega.nombre, urlDueno, urlUsuarios: urlIngreso(entrega.slug), email: entrega.email, clave: entrega.clave })
    )
    if (ok) setEntregaCopiada(true)
    else setError('No se pudo copiar. Seleccioná el texto de arriba y copialo a mano.')
  }

  // Datos de una organización ya creada: solo las direcciones (la contraseña no se guarda en ningún lado)
  const copiarDatos = async (o) => {
    const ok = await copiarTexto(
      mensajeParaCliente({ nombre: o.nombre, urlDueno, urlUsuarios: urlIngreso(o.slug), vence: o.vence_el ? fechaLegible(o.vence_el) : null })
    )
    if (ok) {
      setCopiada(o.id)
      setTimeout(() => setCopiada((actual) => (actual === o.id ? null : actual)), 2000)
    } else setError('No se pudo copiar al portapapeles.')
  }

  const abrirNueva = () => {
    setError('')
    setEntrega(null)
    setEntregaCopiada(false)
    setPanel({ tipo: 'nueva', valores: { ...NUEVA_VACIA, clave: generarClave() } })
  }

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    setTrabajando(true)
    if (panel.tipo === 'nueva') {
      const v = panel.valores
      const r = await crearOrganizacion(v)
      if (r.ok) {
        setEntregaCopiada(false)
        setEntrega({
          nombre: v.nombre.trim(),
          slug: r.slug,
          email: v.email_dueno.trim(),
          clave: v.clave || null,
        })
        setPanel(null)
        await recargar()
      } else setError(r.mensaje)
    } else {
      const r = await actualizarOrganizacion(panel.id, panel.valores)
      if (r.ok) {
        setPanel(null)
        await recargar()
      } else setError(r.mensaje)
    }
    setTrabajando(false)
  }

  const v = panel?.valores
  return (
    <ConfigPagina titulo="Organizaciones" permiso="superadmin">
      <div className="config-barra">
        <input
          type="search"
          className="config-buscador"
          placeholder="Buscador…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar"
        />
        <button type="button" className="config-btn config-btn-primario" onClick={abrirNueva}>
          + Nueva organización
        </button>
      </div>
      <p className="config-ayuda">
        Acá ves solo datos generales de cada cliente (usuarios y torneos): nunca sus resultados, jueces ni competidores. Una
        organización suspendida o vencida deja de ver y guardar datos, pero no se borra nada.
      </p>

      {entrega && (
        <div className="cuenta-aviso">
          <p>
            Organización <strong>{entrega.nombre}</strong> creada. Pasale esto al cliente (la contraseña no se vuelve a mostrar):
          </p>
          <p>
            Ingreso del dueño: <span className="config-credencial">{urlDueno}</span>
            <br />
            Email: <span className="config-credencial">{entrega.email}</span>
            {entrega.clave ? (
              <>
                {' '}
                · Contraseña inicial: <span className="config-credencial">{entrega.clave}</span>
              </>
            ) : (
              ' · Le llega una invitación por email para elegir su contraseña.'
            )}
            <br />
            Ingreso de sus usuarios: <span className="config-credencial">{urlIngreso(entrega.slug)}</span>
          </p>
          <div className="config-fila-acciones">
            <button type="button" className="config-btn config-btn-primario" onClick={copiarEntrega}>
              {entregaCopiada ? 'Copiado ✓' : 'Copiar'}
            </button>
            {/* solo se puede cerrar después de copiar: la contraseña no se vuelve a mostrar */}
            {entregaCopiada && (
              <button type="button" className="config-btn" onClick={() => setEntrega(null)}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      )}

      {panel && (
        <form className="config-previa" onSubmit={guardar}>
          <p>
            <strong>{panel.tipo === 'nueva' ? 'Nueva organización' : `Editar ${panel.nombreOriginal}`}</strong>
          </p>
          <div className="config-formulario">
            <label>
              {panel.tipo === 'nueva' ? 'Nombre de la organización' : 'Nombre'}
              <input
                className="config-buscador"
                required
                autoFocus={panel.tipo === 'nueva'}
                maxLength={80}
                value={v.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
              />
            </label>
            {panel.tipo === 'nueva' ? (
              <>
                <label>
                  Email del cliente
                  <input
                    className="config-buscador"
                    type="email"
                    required
                    value={v.email_dueno}
                    onChange={(e) => cambiar('email_dueno', e.target.value)}
                  />
                </label>
                <label>
                  Contraseña inicial (vacía = invitación por email)
                  <input
                    className="config-buscador"
                    minLength={v.clave ? 8 : undefined}
                    maxLength={72}
                    spellCheck={false}
                    value={v.clave}
                    onChange={(e) => cambiar('clave', e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                Estado
                <select className="config-buscador" value={v.estado} onChange={(e) => cambiar('estado', e.target.value)}>
                  {Object.entries(ESTADOS_ORGANIZACION).map(([valor, texto]) => (
                    <option key={valor} value={valor}>
                      {texto}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Vence el (opcional)
              <input className="config-buscador" type="date" value={v.vence_el} onChange={(e) => cambiar('vence_el', e.target.value)} />
            </label>
            {panel.tipo === 'editar' && (
              <label>
                Notas internas
                <input className="config-buscador" maxLength={500} value={v.notas} onChange={(e) => cambiar('notas', e.target.value)} />
              </label>
            )}
          </div>
          {panel.tipo === 'nueva' && slugDesdeNombre(v.nombre) && (
            <p className="config-ayuda">Sus usuarios van a entrar por: {urlIngreso(slugDesdeNombre(v.nombre))}</p>
          )}
          <div className="config-fila-acciones">
            <button type="submit" className="config-btn config-btn-primario" disabled={trabajando}>
              {trabajando ? 'Guardando…' : panel.tipo === 'nueva' ? 'Crear organización' : 'Guardar'}
            </button>
            {panel.tipo === 'nueva' && (
              <button type="button" className="config-btn" onClick={() => cambiar('clave', generarClave())}>
                Generar otra
              </button>
            )}
            <button type="button" className="config-btn" onClick={() => setPanel(null)} disabled={trabajando}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && <div className="cuenta-error">{error}</div>}

      <div className="config-tabla-wrap">
        <table className="config-tabla">
          <thead>
            <tr>
              <th>Organización</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Vence</th>
              <th>Usuarios</th>
              <th>Torneos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargandoLista ? (
              <tr>
                <td colSpan={7}>Cargando…</td>
              </tr>
            ) : visibles.length === 0 ? (
              <tr>
                <td colSpan={7}>{filas.length === 0 ? 'Todavía no hay organizaciones.' : 'Ninguna con ese filtro.'}</td>
              </tr>
            ) : (
              visibles.map((o) => (
                <tr key={o.id} className={o.estado === 'suspendida' ? 'config-inactivo' : ''}>
                  <td>
                    {o.nombre}
                    <br />
                    <span className="config-ayuda">/{o.slug}</span>
                    {o.notas && (
                      <>
                        <br />
                        <span className="config-ayuda">{o.notas}</span>
                      </>
                    )}
                  </td>
                  <td>{o.plan}</td>
                  <td>
                    <span className={`config-estado ${o.estado === 'activa' ? 'ok' : o.estado === 'prueba' ? 'pend' : 'off'}`}>
                      {ESTADOS_ORGANIZACION[o.estado] ?? o.estado}
                    </span>
                  </td>
                  <td>{fechaLegible(o.vence_el)}</td>
                  <td>{o.usuarios}</td>
                  <td>{o.torneos}</td>
                  <td>
                    <span className="config-iconos">
                      <button
                        type="button"
                        title="Editar"
                        aria-label={`Editar ${o.nombre}`}
                        onClick={() => {
                          setError('')
                          setEntrega(null)
                          setPanel({
                            tipo: 'editar',
                            id: o.id,
                            nombreOriginal: o.nombre,
                            valores: { nombre: o.nombre, plan: o.plan, estado: o.estado, vence_el: o.vence_el ?? '', notas: o.notas ?? '' },
                          })
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        title="Copiar los datos para pasarle al cliente"
                        aria-label={`Copiar los datos de ${o.nombre} para pasarle al cliente`}
                        onClick={() => copiarDatos(o)}
                      >
                        {copiada === o.id ? '✅' : '📋'}
                      </button>
                      <button
                        type="button"
                        title="Copiar la dirección de ingreso"
                        aria-label={`Copiar la dirección de ingreso de ${o.nombre}`}
                        onClick={() => navigator.clipboard?.writeText(urlIngreso(o.slug))}
                      >
                        🔗
                      </button>
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="config-ayuda">
        {visibles.length} de {filas.length}
      </p>
    </ConfigPagina>
  )
}

export default ConfigOrganizaciones
