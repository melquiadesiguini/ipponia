# Plan: IPPONIA multi-organización (Etapa 1: organizaciones, usuarios, roles y permisos)

Estado: **APROBADO (decisiones del punto 10). En ejecución: Etapa 0.**
Alcance: solo la base. Puntuación y pantalla pública siguen igual (localStorage + evento `storage`).

---

## 0. Punto de partida (lo que ya hay en el repo)

| Tema | Hoy | Con este plan |
|---|---|---|
| Organizaciones | `organizations` (plan libre en texto, estado, vencimiento) | `organizaciones` con `slug` y plan en tabla `planes` (hoy uno solo) |
| Usuarios | `auth.users` con email real + `members.role` (4 roles fijos) | `perfiles` con `nombre_usuario` (email sintético interno); dueño con email real |
| Roles | 4 fijos en texto (administrador, supervisor, mesa, juez) | `roles` + `rol_permisos` editables por organización |
| Torneos | no existen | `torneos` + `asignaciones` (rol por torneo y área) |
| Superadmin | `platform_admins` + RPC | `superadmins` (misma idea, tabla separada y más restringida) |
| Alta de usuarios | invitación por email (`invitaciones`) | Edge Function que crea la cuenta con usuario y contraseña |
| Login | `/cuenta` con email | `/:slugOrg/ingresar` (usuario+clave) y `/ingresar` (dueño y superadmin, con email) |
| Datos | `jueces`, `competidores`, `results` por `org_id` | igual, pero con RLS por permiso |

Lo que se **descarta** (se reemplaza, no se parchea): `members`, `invitaciones`, `listar_equipo`, `crear_organizacion` actual, las páginas `ConfigUsuarios` y `ConfigOrganizaciones`. Son pocas líneas y hoy hay una sola organización real, así que es el momento más barato para cambiar el modelo.

---

## 1. Decisiones de diseño (y por qué)

1. **Un usuario interno pertenece a una sola organización.** Si una persona trabaja en dos organizaciones, tiene dos cuentas (dos filas en `auth.users`, dos emails sintéticos distintos). *Por qué:* es lo que pediste y simplifica todo: `perfiles.organizacion_id` es único por usuario y las políticas RLS no necesitan elegir "organización activa".
2. **Email sintético `usuario@slug.ipponia.internal`.** Supabase Auth exige email; el usuario nunca lo ve. Se arma en el frontend (login) y en la Edge Function (alta). *Por qué `.internal`:* es un TLD reservado para uso privado, no puede recibir mail real. **Se verifica con una prueba corta antes de seguir** (ver Etapa 0), porque Supabase podría rechazar el dominio.
3. **El `slug` es inmutable.** Está dentro del email sintético; cambiarlo rompería todos los logins de esa organización. Un trigger impide modificarlo. Si algún día hace falta, se hace con un script que reescriba los emails.
4. **Los permisos se evalúan en SQL con `tiene_permiso(torneo, area, permiso)`** (`security definer`, lee `auth.uid()`). *Por qué:* una sola función usada por todas las políticas RLS y por el frontend (vía RPC `mis_permisos`) evita que la regla viva en dos lugares con comportamientos distintos.
5. **El plan limita, el rol concede.** Un permiso está activo solo si lo tiene el rol **y** el plan de la organización lo incluye. *Por qué:* si una organización baja de plan, pierde las funciones al instante sin tener que tocar sus roles.
6. **Catálogo de permisos en dos lugares sincronizados:** constante en el código (`src/lib/permisos.js`, para textos y pantallas) y tabla `permisos` en la base (para claves foráneas y para que RLS no dependa del frontend). Una migración los sincroniza; un chequeo en el build avisa si se desfasan.
7. **Asignaciones, no roles pegados al usuario.** `asignaciones(usuario, torneo nullable, area nullable, rol)`. `torneo = null` significa "toda la organización" (el Admin permanente); `area = null` significa "todas las áreas".
8. **Rutas sin colisión:** el slug no puede ser una palabra reservada (`kata`, `kumite`, `cuenta`, `ingresar`, `configuracion`, `api`…). Se valida con un `check` en la base y en el formulario de alta.
9. **Service role solo en Edge Functions.** Se inyecta automáticamente como variable de entorno del servidor de Supabase; nunca pasa por el frontend ni por el repo.
10. **Seguridad por defecto:** todas las tablas con RLS activada y sin permisos para `anon`; los accesos públicos mínimos (mostrar el nombre de una organización en su pantalla de ingreso) van por una función `org_publica(slug)` que devuelve solo nombre y estado.

---

## 2. Esquema (migraciones versionadas)

Archivos en `supabase/migrations/AAAAMMDDHHMM_nombre.sql`, aplicables en orden. Los SQL actuales (`roles.sql`, `configuracion.sql`…) se mueven a `supabase/legacy/` como historial.

```text
planes(clave pk: hoy 'estandar', nombre)
permisos(clave pk, descripcion)                          -- catálogo fijo
plan_permisos(plan, permiso)                             -- qué incluye cada plan

organizaciones(id, slug unique/immutable, nombre, plan -> planes (hoy solo 'estandar'),
               estado: prueba|activa|suspendida, vence_el, creada_en)
perfiles(usuario_id pk -> auth.users, organizacion_id, nombre_usuario,
         nombre_visible, es_dueno, activo, debe_cambiar_clave,
         unique(organizacion_id, nombre_usuario))        -- username en minúsculas
torneos(id, organizacion_id, nombre, fecha, estado)
roles(id, organizacion_id, nombre, de_fabrica, unique(organizacion_id, nombre))
rol_permisos(rol_id, permiso)
asignaciones(id, organizacion_id, usuario_id, torneo_id null, area null, rol_id)
superadmins(usuario_id pk -> auth.users)
auditoria(id, cuando, organizacion_id, actor_id, accion, detalle jsonb)
```

Datos existentes: `jueces`, `competidores`, `results` se mantienen (ya tienen `org_id`); se renombra a `organizacion_id` y se les cambia la política.

**Catálogo inicial de permisos** (ajustado a las pantallas reales):

| Permiso | Pantalla / acción |
|---|---|
| `ver_pantalla_publica` | `/pantalla` (hoy abierta; pasa a requerir sesión de la organización) |
| `operar_mesa_kumite` | `/kumite/mesa` |
| `operar_kansa_kumite` | `/kumite/kansa` |
| `puntuar_kata`, `puntuar_kobudo`, `puntuar_destreza` | módulos |
| `cargar_competidores` | lista y Excel de competidores |
| `gestionar_jueces` | lista y Excel de jueces (hoy existe aparte) |
| `ver_historial` | historial de resultados |
| `crear_torneos` | torneos |
| `gestionar_usuarios` | crear, desactivar, resetear clave |
| `gestionar_roles` | roles y asignaciones |

**Planes:** por ahora hay **un solo plan** (clave `estandar`) que incluye todos los permisos. La estructura (`planes`, `plan_permisos`) queda lista para sumar planes más adelante sin cambiar el código: alcanza con insertar filas.

**Roles de fábrica** (se crean con la organización, editables): Admin (todos los del plan), Juez (`puntuar_*`), Kansa (`operar_kansa_kumite`), Fukushin (`puntuar_*` + `ver_pantalla_publica`), Mesa (`operar_mesa_kumite`, `puntuar_*`, `ver_pantalla_publica`, `cargar_competidores`).

---

## 3. RLS y `tiene_permiso`

```text
tiene_permiso(p_torneo uuid, p_area text, p_permiso text) -> boolean
  1. perfil = perfiles donde usuario_id = auth.uid() y activo
  2. la organización está activa (estado + vencimiento)
  3. el permiso está en el plan de la organización (plan_permisos)
  4. existe una asignación del usuario donde:
       (torneo_id is null  OR torneo_id = p_torneo)
       AND (area is null   OR area = p_area)
     cuyo rol incluye p_permiso
  p_torneo null = consulta "a nivel organización": solo cuentan asignaciones con torneo_id null.
```

Políticas (todas filtran además por `organizacion_id = mi_organizacion()`):

- `perfiles`: ver los de mi organización; modificar solo con `gestionar_usuarios` (y los altas/bajas por Edge Function).
- `roles`, `rol_permisos`, `asignaciones`: ver los de mi organización; modificar con `gestionar_roles`. **Candado:** no se puede quitar `gestionar_usuarios`/`gestionar_roles` al último Admin (trigger), para que nadie deje a la organización sin administración.
- `torneos`: ver los de mi organización; crear/editar con `crear_torneos`.
- `jueces`, `competidores`: por `gestionar_jueces` / `cargar_competidores`.
- `organizaciones`: cada miembro ve solo la suya; plan/estado/vencimiento solo el superadmin (por columna, como hoy).
- Superadmin: tabla propia; **no** tiene acceso general a datos de organizaciones (ver 4).

**Prueba de aislamiento:** un script SQL (`supabase/tests/aislamiento.sql`) crea dos organizaciones y usuarios, simula sus JWT con `set local role authenticated` y comprueba que A no lee ni escribe nada de B, y que el permiso por torneo/área funciona. Se corre antes de dar por buena cada migración.

---

## 4. Superadmin

- Tabla `superadmins` (hoy `platform_admins`). Solo se agrega desde el SQL Editor, nunca desde la app.
- **Menor privilegio:** el superadmin **no** lee los datos deportivos de los clientes. Ve un panel con: lista de organizaciones, plan, estado, vencimiento, cantidad de usuarios y torneos (funciones `security definer` que devuelven solo esos agregados). *Por qué:* limita el daño si esa cuenta se compromete y es más defendible ante un cliente.
- Alta de cliente = Edge Function `crear-organizacion` (solo superadmin): crea la organización con `slug`, plan y vencimiento, genera los roles de fábrica y envía la invitación por email al dueño (`inviteUserByEmail`), que elige su contraseña y queda como Admin permanente.

---

## 5. Edge Functions (Deno, en `supabase/functions/`)

Todas: verifican el JWT del llamador, validan la entrada, derivan la organización **del perfil del llamador** (nunca de un parámetro), responden con CORS limitado al dominio del sitio y registran en `auditoria`.

| Función | Quién | Qué hace |
|---|---|---|
| `crear-usuario` | permiso `gestionar_usuarios` | valida `nombre_usuario` (minúsculas, `a-z0-9._-`, 3–30), arma el email sintético, `auth.admin.createUser({ email_confirm: true, password })`, inserta `perfiles`; si falla el insert, borra el usuario de Auth (rollback) |
| `resetear-clave` | `gestionar_usuarios` | solo sobre usuarios de **su** organización; `auth.admin.updateUserById`, cierra sesiones, marca `debe_cambiar_clave` |
| `desactivar-usuario` | `gestionar_usuarios` | `activo=false` + ban en Auth; no se borra (se conserva el historial) |
| `crear-organizacion` | superadmin | ver punto 4 |

El llamador se autoriza llamando a `tiene_permiso` con **su propio JWT**; recién después se usa el cliente con service role para la operación privilegiada. Así la regla de permisos sigue viviendo en un solo lugar (SQL).

Requisito práctico: publicar funciones necesita la CLI de Supabase (`supabase functions deploy`) o pegarlas desde el panel. Lo dejo en la Etapa 0.

---

## 6. Routing en GitHub Pages: ¿es compatible `/:slugOrg/ingresar`?

**Sí.** Hoy el sitio ya usa `BrowserRouter` con `basename=/ipponia/` y el truco `404.html` (spa-github-pages) con `pathSegmentsToKeep = 1`: cualquier ruta que no exista como archivo (`/ipponia/fakko/ingresar`) devuelve el 404.html, que la reescribe como `/ipponia/?/fakko/ingresar` y `index.html` la restaura. Ya funciona hoy con `/ipponia/kata`.

Observaciones:
- El navegador recibe un 404 HTTP antes del redireccionamiento (no afecta a una app privada, pero hay un parpadeo corto en el primer ingreso directo).
- **Colisión de nombres:** `/:slugOrg` choca con rutas fijas. Solución: rutas fijas primero en el router y lista de slugs reservados (punto 1.8).
- Con **dominio propio** (`ipponia.com`) cambia solo `base: '/'` y `pathSegmentsToKeep = 0`. Los subdominios por organización (`fakko.ipponia.com`) **no** son posibles en GitHub Pages (no admite comodines); si alguna vez se quieren, hay que pasar a Cloudflare Pages o Netlify. Por ahora, rutas con slug.

---

## 7. Cambios en React

```text
src/
  lib/permisos.js            catálogo (clave, etiqueta, pantalla) + utilidades
  lib/api/                   llamadas a RPC y Edge Functions (usuarios, roles, torneos)
  context/AuthProvider       + perfil (organización, usuario, es_dueño, superadmin)
  context/PermisosProvider   carga mis_permisos(torneo) al entrar a un torneo
  hooks/usePermiso.js        const puede = usePermiso('puntuar_kata', { area })
  components/Requiere.jsx    <Requiere permiso="puntuar_kata"> ... </Requiere>
  pages/IngresarOrg.jsx      /:slugOrg/ingresar  (usuario + clave)
  pages/Ingresar.jsx         /ingresar (dueño y superadmin, con email) + "olvidé mi clave"
  pages/RestablecerClave.jsx /restablecer
  pages/org/                 Torneos, Usuarios, Roles, Asignaciones
  pages/superadmin/          Organizaciones (alta y estado)
```

Rutas: `/ingresar`, `/restablecer`, `/:slugOrg/ingresar`, `/:slugOrg/torneos`, `/:slugOrg/torneos/:torneoId/*` (módulos), `/superadmin/*`. Mientras dura la etapa, **las rutas actuales (`/kata`, `/kumite/mesa`…) siguen funcionando con localStorage**; solo se les agrega el filtro por permisos a nivel organización. La navegación muestra solo lo permitido (UX); la seguridad real es RLS.

---

## 8. Etapas

**Etapa 0 – Preparación (corta, sin riesgo)**
- Prueba (spike): crear por la API un usuario con email `@x.ipponia.internal` ya confirmado y loguearse. Si Supabase lo rechaza, se cambia el dominio sintético.
- Instalar la CLI de Supabase y vincular el proyecto (o definir el flujo por el panel). Crear `supabase/migrations/` y mover el SQL actual a `legacy/`.

**Etapa 1 – Base de datos** (migraciones + prueba de aislamiento)
- Catálogo, planes, organizaciones, perfiles, roles, asignaciones, torneos, superadmins, auditoría.
- `tiene_permiso`, `mis_permisos`, `org_publica`, políticas RLS y triggers (slug inmutable, candado del último Admin, roles de fábrica).
- Migración de los datos actuales (tu organización y tu usuario) al modelo nuevo.

**Etapa 2 – Edge Functions**: `crear-organizacion`, `crear-usuario`, `resetear-clave`, `desactivar-usuario` + pruebas.

**Etapa 3 – Frontend**: login por organización, contexto de permisos, paneles (usuarios, roles, asignaciones, torneos), panel de superadmin, filtro de menús.

**Etapa 4 – Cierre y convivencia**: retirar `members`, invitaciones y páginas viejas; revisar que localStorage siga igual; documentación.

*Después (fuera de esta etapa):* mover el estado de Kata/Kumite a la base y tiempo real (incluye la función de jueces conectados que quedó guardada aparte).

---

## 9. Riesgos y cuidados

- **Bloqueo por error de permisos:** candado del último Admin + cuenta superadmin que siempre puede restablecer.
- **Fuerza bruta de contraseñas:** límites de Supabase Auth por IP; se suma contador de intentos fallidos por cuenta en una etapa posterior si hace falta.
- **Enumeración de usuarios:** el login responde siempre "usuario o contraseña incorrectos".
- **Contraseñas:** mínimo 8 en usuarios internos; el admin entrega la inicial y se obliga a cambiarla en el primer ingreso (`debe_cambiar_clave`).
- **Deriva del catálogo** código/base: chequeo en el build.
- **Costo de Supabase:** el plan gratuito alcanza para esta etapa; el tiempo real (etapa posterior) es lo que más consume.

---

## 10. Decisiones confirmadas

1. **Alta de organizaciones solo por el superadmin.** Sin autoregistro. (Se mantiene "Solicitar acceso" por WhatsApp.)
2. **Un solo plan** por ahora (`estandar`, con todos los permisos). Se diseña para poder agregar más.
3. **Tablas en español** (`organizaciones`, `perfiles`, `roles`…). Se renombra ahora.
4. **El superadmin ve solo agregados** de las organizaciones (nombre, plan, estado, vencimiento, cantidad de usuarios y torneos), no sus datos deportivos.
5. **Contraseña inicial con cambio obligatorio** en el primer ingreso de usuarios internos.
6. **Sin límites por plan** por ahora (cantidad de usuarios o torneos); se analiza más adelante.
7. **Dominio sintético `ipponia.internal`** (a validar en la Etapa 0).

---

## 11. Etapa 0: seguimiento

- [x] CLI de Supabase disponible vía `npx supabase` (v2.120). No hace falta instalarlo.
- [x] `supabase/migrations/` y `supabase/tests/` creadas; SQL anterior movido a `supabase/legacy/` (solo historial).
- [x] `supabase init` (genera `supabase/config.toml`).
- [x] **Prueba del email sintético**: Supabase acepta `usuario@x.ipponia.internal` y permite iniciar sesión.
- [ ] `npx supabase login` (lo hacés vos una vez; abre el navegador) para poder publicar Edge Functions.

## 12. Etapa 1: seguimiento

- [x] Migración escrita: `supabase/migrations/20261013120000_multiorganizacion.sql` (catálogo, tablas en español, `tiene_permiso`, RLS, candados, migración de datos, retiro del modelo viejo).
- [x] Pruebas locales (`npm run test:db`): **94 correctas** (migración de datos, aislamiento entre organizaciones, permisos por torneo/área, plan, organización suspendida/vencida, superadmin, candados).
- [x] **Aplicada en Supabase** (13/10/2026). Verificada: organización `ikigai-dojo` (plan estandar), 1 perfil dueño, 5 roles, 1 asignación, 1 superadmin, 12 permisos, jueces y resultados conservados, todas las tablas con RLS, sin triggers viejos. La nube del frontend viejo queda inactiva hasta la Etapa 3.
- [x] "Allow new users to sign up" desactivado en Authentication (verificado tras recargar).

## 13. Etapa 2: seguimiento (Edge Functions)

- [x] Código en `supabase/functions/`: `crear-organizacion`, `crear-usuario`, `resetear-clave`, `desactivar-usuario` (+ `_shared/`).
- [x] La lógica está separada de Supabase (`acciones.ts`) y probada con un servicio simulado: **20 pruebas** (`npm run test:functions`).
- [x] Tipos revisados con `deno check` (incluida la conexión real a supabase-js).
- [x] Migración `20261013130000_soporte_edge_functions.sql` (cerrar sesiones de un usuario) aplicada en Supabase. Pruebas de base de datos: **101 correctas**.
- [x] Las 4 funciones publicadas desde el editor del panel de Supabase (no hizo falta el login del CLI) y con "Verify JWT with legacy secret" apagado: las sesiones usan claves nuevas (ES256) y cada función verifica la sesión por su cuenta.
- [x] Prueba real con la sesión del dueño (13/10/2026): `crear-usuario` pasa perfil, organización vigente y permiso; `crear-organizacion` reconoce al superadmin; `resetear-clave` y `desactivar-usuario` consultan con la clave de servicio. Las cuatro rechazaron los datos inválidos antes de crear nada.
- [ ] Pendiente menor: `desactivar-usuario` y `crear-organizacion` siguen en la primera versión (claves heredadas SUPABASE_ANON_KEY/SERVICE_ROLE_KEY, marcadas DEPRECATED). Funcionan; actualizarlas a SUPABASE_PUBLISHABLE_KEYS/SECRET_KEYS (ya hecho en `crear-usuario` y `resetear-clave`).
- [ ] Configurar SMTP propio antes de usar invitaciones por email con clientes reales.

## 14. Etapa 3: seguimiento (frontend)

Sub-etapas: **3a** sesión, permisos, ingreso por organización · **3b** Usuarios, Roles/Asignaciones, Torneos · **3c** panel del superadmin · **3d** limpieza y publicación.

### 3a (hecha en el código, falta probar con una cuenta real)
- [x] Migración `20261013140000_mis_permisos_todos.sql` aplicada en Supabase (la función `mis_permisos_todos()` devuelve todos los permisos del usuario con torneo y área). Pruebas de base de datos: **107 correctas**.
- [x] `AuthProvider` reescrito: perfil + organización (`perfiles` con `organizaciones`), `es_superadmin`, permisos; ayudantes `puede()` / `puedeAlguno()`; ingreso por usuario o por email; recuperación y cambio de contraseña.
- [x] Rutas: `/:slugOrg/ingresar` (usuario + contraseña), `/ingresar` (email: dueño y superadmin), `/restablecer`, `/cambiar-clave` (obligatorio la primera vez), `/cuenta`. Se recuerda la última organización para redirigir. `/registro` eliminado.
- [x] `RutaProtegida`: sin sesión → ingreso; cuenta sin organización, usuario desactivado, organización suspendida/vencida y cambio de contraseña pendiente muestran su aviso.
- [x] `RequierePermiso` en cada módulo (Kata, Kumite mesa/kansa, Kobudo, Destreza); Header y Configuración muestran solo lo permitido.
- [x] `resultados.js`, `personas.js`, `camposPersonas.js` apuntan al esquema nuevo (`resultados`, `organizacion_id`, `creado_por`, `creado_en`).
- [x] Se quitaron `ConfigUsuarios`, `ConfigOrganizaciones`, `lib/equipo.js`, `lib/organizaciones.js`, `lib/roles.js` (se reemplazan en 3b y 3c).

### 3b (hecha en el código, falta probar con una cuenta real)
- [x] **Usuarios** (`/configuracion/usuarios`, permiso `gestionar_usuarios`): alta con contraseña inicial generada (se muestra una sola vez para entregarla), restablecer contraseña, activar/desactivar (Edge Functions), buscador y filtro por estado. Al dueño no se le restablece la clave ni se lo desactiva (lo exigen también las funciones y la base).
- [x] **Asignaciones** (botón 🎭 en cada usuario): rol + torneo (o toda la organización) + área opcional. Editarlas pide `gestionar_roles`; con solo `gestionar_usuarios` se ven. El Admin permanente del dueño no se puede quitar.
- [x] **Roles** (`/configuracion/roles`, permiso `gestionar_roles`): crear, renombrar y borrar roles propios; marcar permisos con casillas; el Admin conserva los permisos de gestión.
- [x] **Torneos** (`/configuracion/torneos`, permiso `crear_torneos`): crear, editar, cambiar estado y borrar.
- [x] Capa de datos: `lib/funciones.js` (llama a las Edge Functions con la sesión del usuario), `usuarios.js`, `roles.js`, `torneos.js`, `errores.js`. Las reglas de seguridad siguen siendo las de la base (RLS y candados); la pantalla solo muestra sus mensajes.

### 3c (hecha en el código, falta probar con la cuenta de superadmin)
- [x] **Organizaciones** (`/configuracion/organizaciones`, solo superadmin): lista con plan, estado, vencimiento, cantidad de usuarios y torneos (solo agregados, vía `superadmin_resumen`); alta de un cliente con la función `crear-organizacion` (dueño con contraseña inicial generada, o invitación por email si se deja vacía; requiere SMTP); edición de nombre, estado (prueba / activa / suspendida), vencimiento y notas con `superadmin_actualizar_organizacion`; botón para copiar la dirección de ingreso `/:slug/ingresar`.
- [x] `supabase/config.toml` corregido a `verify_jwt = false`, igual que el panel de Supabase.

### 3d (cierre)
- [x] Limpieza: se quitó `urlRegistro` (ya no existe `/registro`); no quedan referencias al modelo viejo (`mi_org_id`, `members`, `platform_admins`, `organizations`) fuera de `supabase/legacy/` y las pruebas.
- [x] Chequeos finales: lint sin errores, `npm run test:db` **107 correctas**, `npm run test:functions` **20 correctas**, build correcto.
- [x] Sitio publicado generado en `docs/` (`npx vite build --outDir docs --emptyOutDir`). Falta el commit y el push a `main` para que GitHub Pages lo sirva.
- [x] Probado a mano con cuentas reales (Etapas 3a, 3b y 3c): ingreso por organización y por email, cambio obligatorio de contraseña, usuarios, roles, asignaciones, torneos y panel del superadmin.

### Pendientes después de la Etapa 3
- Configurar SMTP propio en Supabase (invitaciones y recuperación de contraseña por email) antes de tener clientes reales.
- Actualizar `desactivar-usuario` y `crear-organizacion` a las claves nuevas (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`); hoy funcionan con las heredadas.
- Elegir torneo activo en la pantalla de trabajo y guardar `torneo_id` en cada resultado (hoy se guarda sin torneo; los permisos por torneo y área ya existen en la base).
- Reincorporar "jueces conectados" (puntaje en tiempo real), hoy guardado en `stash@{0}`.
- Dominio propio (`ipponia.com`) y marca en el INPI; con dominio propio cambia `base` a `/` y `pathSegmentsToKeep` a 0 en `public/404.html`.

## 15. Resultados separados por estructura (15/10/2026)

- [x] Migración `20261015120000_resultados_por_estructura.sql`: dos tablas con columnas reales en lugar del JSON único.
  - `resultados_jurado` (Kata, Kobudo, Destreza): competidor, kata, área y ronda (enteros), sistema de jueces (3 o 5), responsable de mesa, un juez por columna (nombre y puntaje; con 3 jueces el 3 y el 4 quedan en NULL), jueces descartados, puntaje final y `creado_en` (hora del servidor).
  - `resultados_kumite`: marcador, ganador, faltas, salida, encho-sen, duración restante, sistema de jueces.
  - Restricciones en la base (puntajes de 0 a 10, coherencia entre sistema y jueces, módulo válido) y RLS por permiso y organización; no se editan ni se borran desde la API.
  - Los resultados anteriores se convirtieron automáticamente; la tabla vieja quedó como `resultados_archivo` (copia de seguridad sin acceso desde la API).
- [x] Código: `lib/filasResultados.js` reparte lo que entregan las pantallas en columnas; `lib/resultados.js` guarda y lista las dos tablas; el Historial lee las filas reales. Pruebas de base de datos: **150 correctas**, incluida la ejecución del código de la app contra el esquema.

## 16. Corregir y borrar resultados del historial (15/10/2026)

- [x] Migración `20261015140000_editar_historial.sql`: permiso nuevo `editar_historial` (lo trae el rol Admin de cada organización, también las nuevas; se le puede dar a otros roles desde Configuración → Roles).
  - Se puede corregir y borrar con ese permiso; no se puede cambiar de qué organización, módulo o sistema de jueces es un resultado, ni quién ni cuándo lo cargó.
  - Cada corrección deja `editado_por` y `editado_en`; cada corrección y cada borrado quedan en la auditoría con una copia de cómo era el resultado antes (y cómo quedó).
- [x] Historial: columna Acciones (corregir y borrar) para quien tiene el permiso; el formulario recalcula el puntaje final con las mismas reglas que al cargarlo (`calcularPuntaje`); las filas corregidas llevan la marca "corregido".
- [x] Migración `20261015130000_corregir_acentos_transferir_dueno.sql`: arregla "Dueño" (codificación al pegar el SQL).
- [x] Pruebas de base de datos: **183 correctas** (incluye el código del formulario de corrección contra el esquema real).

## 17. Un torneo abierto por vez; los resultados van a ese torneo (15/10/2026)

- [x] Regla (migración `20261015150000_torneo_abierto.sql`): cada organización tiene como máximo **un torneo abierto** (estado `activo`); los demás están en borrador o cerrados (`finalizado`). Para abrir otro hay que cerrar el que está abierto.
- [x] Todo resultado nuevo (jurado o kumite) se guarda **automáticamente en el torneo abierto** (lo asigna la base, lo que mande la aplicación se ignora). **Sin torneo abierto no se puede guardar ningún resultado.**
- [x] Pantallas de trabajo (Kata, Kobudo, Destreza, Kumite): muestran en qué torneo se guarda, o un aviso en rojo si no hay uno abierto (y no dejan obtener el puntaje ni guardar). Sin sesión o en modo local no se aplica.
- [x] Configuración → Torneos: estados "Abierto" y "Cerrado", con botones **Abrir / Cerrar torneo / Reabrir**.
- [x] Historial: columna y filtro por torneo ("Sin torneo" incluido), exportación con la columna Torneo; al corregir un resultado se lo puede asignar o pasar a otro torneo (sirve para ordenar los resultados anteriores).
- [x] Pruebas de base de datos: **194 correctas**.
- [ ] Pendiente a decidir: hoy cualquier usuario con permiso para cargar puede cargar en el torneo abierto de su organización. Si se quiere que alguien asignado solo a un torneo no pueda cargar en otro, hay que ajustar la regla de seguridad (RLS) para que use `tiene_permiso(torneo, área, permiso)`.

## 18. Propuesta comercial: planes, módulos y formas de pago (16/10/2026)

**Estado: propuesta para discutir.** Los precios son hipótesis de partida, no están validados con clientes. Todavía no hay cambios en el código ni en la base.

### 18.1 Dos ejes independientes
- **Qué contratan:** un plan cerrado (Básico, Estándar o Premium) o módulos sueltos.
- **Cómo pagan:** por mes o por torneo.
- Los planes son combos de módulos con descuento: quien arma módulos sueltos nunca paga menos que un plan, y el plan siempre le conviene.

### 18.2 Qué se vende
- **Módulos de competencia:** Kata, Kobudo, Destreza y Kumite.
- **Funciones:** pantalla pública, historial con exportación, corrección del historial con auditoría, usuarios y roles por torneo y área, y jueces conectados (todavía no existe).

| | Básico | Estándar | Premium |
|---|---|---|---|
| Módulos de competencia | 2 a elección | los 4 | los 4 |
| Pantalla pública | sí | sí | sí |
| Historial y exportación | solo ver y exportar | con corrección y auditoría | con corrección y auditoría |
| Usuarios, roles y áreas | 1 usuario administrador | roles por torneo y área | roles por torneo y área |
| Jueces conectados | no | no | sí (cuando esté) |
| Soporte | por mail | por mail | prioritario |

### 18.3 Precios de partida (USD)

| | Básico | Estándar | Premium |
|---|---|---|---|
| **Por mes** | 15 | 30 | 60 |
| **Por torneo** | 45 | 90 | 180 |

- Regla: el precio por torneo equivale a unos 3 meses de cuota. Con 4 o más torneos al año conviene la cuota mensual; con menos, conviene pagar por torneo.
- **Modular (a la carte):** cuota base de 8 por mes (24 por torneo) más 8 por mes (24 por torneo) por cada módulo. Con los 4 módulos da 40 por mes, más caro que el Estándar (30).
- **Piso de costos:** Supabase Pro + dominio + correo ≈ USD 27 por mes. Con 2 o 3 clientes Estándar se cubre la infraestructura.

### 18.4 Infraestructura que se contrata (precios aproximados, verificar)
- Dominio (`ipponia.com` u otro): ~USD 10–15 por año. Hace falta para enviar mails a terceros (invitaciones y recuperación de contraseña).
- Correo (SMTP, p. ej. Resend): plan gratis de unos 3.000 mails por mes; luego desde ~USD 20 por mes.
- Supabase Pro: ~USD 25 por mes. El plan gratis se pausa por inactividad y no tiene copias de seguridad, así que con clientes reales hay que pasar a Pro.
- GitHub Pages: gratis, acepta dominio propio.
- Orden recomendado al llegar el primer cliente que paga: Supabase Pro, dominio, correo.

### 18.5 Argentina ahora, el mundo después
- Precios fijados en USD; en Argentina se cobra el equivalente en pesos (Mercado Pago o transferencia).
- Para el exterior: procesador que actúe como "merchant of record" (Paddle o Lemon Squeezy), que cobra, factura y maneja los impuestos de cada país. Verificar qué aceptan a vendedores argentinos.
- Consultar con un contador cómo facturar antes de cobrar al primer cliente.
- Para abrirlo al mundo hay que agregar el idioma inglés (hoy todo está en español).
- Un `.com` sirve para ambos mercados; un `.com.ar` se vería solo local.

### 18.6 Qué soporta hoy el sistema y qué hay que construir
- **Ya existe:** `planes` y `plan_permisos` (hoy un solo plan, `estandar`, con todos los permisos) y `tiene_permiso` que cruza el plan de la organización con los permisos del rol.
- **Por construir:**
  1. Tabla de módulos contratados por organización y qué permisos habilita cada módulo; `tiene_permiso` pasa a exigir plan **y** módulo.
  2. Planes `basico` y `premium` en la base (con la forma de pago por mes o por torneo).
  3. Panel del superadmin para cambiar el plan o los módulos de cada organización.
  4. Si se quieren límites reales (usuarios, áreas), agregarlos: hoy no se controlan.
  5. Cobro manual al principio (el superadmin activa o desactiva); procesador de pagos más adelante.
- Toda la parte de base de datos va en una migración versionada con sus tests.

### 18.7 Decisiones abiertas
- [ ] ¿Precios distintos para Argentina y para el exterior?
- [ ] ¿Cuántos usuarios y áreas tiene un torneo típico del cliente actual? (define si el Básico se limita también por usuarios o áreas)
- [ ] Precio de "cliente fundador" para el cliente actual, antes de que se acostumbre a que sea gratis.
- [ ] Por mes, por torneo, o ambas formas desde el principio.

## 19. Modo sin conexión y guardado automático de Kumite (19/10/2026)

**Para qué:** los torneos suelen hacerse en gimnasios con mala señal. La app tiene que abrir, seguir funcionando y no perder resultados sin internet.

### 19.1 Qué hace
- **La app abre sin internet.** Un service worker (`public/sw.plantilla.js`, que `vite.config.js` convierte en `sw.js` con la lista de archivos de cada versión) deja guardada la app en el dispositivo. Las páginas se piden primero a la red (siempre la versión nueva) y, si no hay conexión, se entrega la app guardada. `version.json` y `sw.js` siempre van a la red; Supabase y las tipografías no se tocan.
- **La sesión y la cuenta sobreviven.** Con el token vencido y sin internet, Supabase no puede renovarlo y dice "sin sesión": se usa la sesión que quedó en el dispositivo (cuando vuelve la conexión, Supabase renueva el token solo). Los datos de la cuenta (perfil, organización y permisos) y el torneo abierto se copian en el dispositivo cada vez que hay conexión (`lib/datosOffline.js`) y se usan si la consulta falla por falta de red. Al cerrar sesión se borra la copia de la cuenta.
- **Los resultados no se pierden.** Si el envío falla por falta de red, el resultado queda en una cola en el dispositivo (`lib/colaResultados.js`) con la hora real y el torneo que estaba abierto, y se envía solo: al abrir la app, al iniciar sesión, cuando el navegador avisa que volvió internet y cada 20 segundos (`SincronizadorOffline`).
- **Nunca se duplica.** Cada resultado nace con su propio `id` (uuid); si un envío llegó pero se perdió la respuesta, el reintento choca con la clave primaria (23505) y se da por enviado.
- **Cada resultado se envía con la sesión de quien lo cargó.** Si otro usuario inicia sesión en la tablet, los resultados del primero esperan.
- **Aviso en el encabezado** (`EstadoConexion`): "Sin conexión", "N por enviar", "Enviando…" o "N sin enviar" con botón Reintentar (cuando la base rechazó alguno, por ejemplo por no haber un torneo abierto). No muestra nada cuando está todo en orden.
- Kata, Kobudo y Destreza no cambian: el mensaje de guardado dice que quedó en el dispositivo y se enviará solo.

### 19.2 Reglas nuevas en la base (migración `20261019120000_resultados_sin_conexion.sql`)
- El envío puede traer `creado_en` (hora real) y `torneo_id` (el que estaba abierto). Un resultado de más de 14 días se rechaza; una hora más de 5 minutos en el futuro se reemplaza por la del servidor.
- El torneo que manda el dispositivo solo se respeta si el resultado llega tarde (más de 2 minutos después de su hora), es de la misma organización y está abierto o cerrado. Si no, vale la regla de siempre: va al torneo abierto, y sin torneo abierto se rechaza.
- Riesgo asumido: quien puede cargar resultados podría, con una hora adelantada hasta 14 días, cargar un resultado en el último torneo cerrado. Queda registrado quién lo cargó (`creado_por`) y el administrador puede corregir o borrar.

### 19.3 Guardado automático en Kumite
- **Mesa:** el combate se guarda solo apenas aparece el ganador (el empate no se guarda: se define en Encho-Sen y se guarda ese resultado). No hay botón de guardar; el cartel muestra cómo salió (guardado, guardado en el dispositivo o error con "Reintentar guardado"). Si se cierra el cartel y no se pudo guardar, queda un aviso arriba del tablero.
- **Kansa:** conserva el botón "Guardar en Historial" (es un tablero independiente y no se guarda solo, para no duplicar los combates de la Mesa).
- El mismo resultado no se guarda dos veces (se compara ganador, nombres, puntajes, categoría y salida).

### 19.4 Pruebas
- `npm run test:db`: **207 correctas** (incluye la sección 8c: hora y torneo del momento, 14 días, duplicados).
- `npm run test:offline`: **36 correctas** (qué es un error de red, la cola, el envío con cortes, rechazos y duplicados, y el service worker).
- Probado a mano en el navegador: con la base inalcanzable, la app abre con la cuenta guardada, el combate de Kumite se guarda en la cola y el aviso del encabezado cuenta los pendientes.

### 19.5 Límites y pendientes
- La primera vez hay que abrir la app **con internet** (para que se instale el service worker y se guarde la cuenta). Un usuario nuevo no puede ingresar por primera vez sin internet.
- Las tipografías de Google no se guardan: sin internet se usa la tipografía del sistema.
- Instalar la app en la pantalla de inicio (PWA) mejora que el sistema operativo no borre lo guardado; el manifiesto ya existe.
- Probar en tablet real: abrir con internet, activar modo avión, recargar y cargar resultados.

## 20. Instalar Ipponia como app y mejoras del modo sin conexión (19/10/2026)

- **Manifiesto** (`public/manifest.webmanifest`): `id`, íconos separados para `any` y `maskable`, orientación libre, categorías y **accesos directos** (mantener apretado el ícono en Android: Kumite, Kata, Kobudo, Destreza). En `index.html`, las etiquetas para iPhone y iPad (título, modo app, barra de estado).
- **Botón "Instalar Ipponia"** en Mi cuenta (`InstalarApp`): en Chrome y Edge usa el aviso del navegador (`beforeinstallprompt`, que se escucha desde que carga la página); en iPhone y iPad (reconocidos aunque el iPad se presente como Mac) explica "Compartir → Agregar a pantalla de inicio"; en otros navegadores indica el menú. Si ya está instalada, lo dice.
- **Aviso de versión nueva** (`AvisoActualizacion`, `lib/serviceWorker.js`): la versión nueva se descarga sola, pero **no se activa en medio de una sesión** (no se corta un combate ni se rompe la pantalla abierta). Aparece "Hay una versión nueva de Ipponia · Actualizar · Más tarde". Se busca cada 30 minutos y al volver a la app (una tablet puede estar abierta todo el día). Si nadie toca "Actualizar", se activa sola al cerrar la app.
- **Tipografías sin internet:** el service worker guarda las tipografías de Google la primera vez que se descargan y las usa después (en un caché aparte, que sobrevive a las versiones).
- **Pruebas:** `npm run test:offline` ahora tiene **47 correctas** (espera de la versión nueva, mensaje "saltear-espera", tipografías y detección de iPhone/iPad).
- **Probado a mano:** el botón de instalación aparece con el aviso del navegador y lo dispara; en Mi cuenta se ve la explicación según el dispositivo.
- **Sin verificar en un navegador real:** el registro del service worker y el aviso de versión nueva (el navegador integrado no deja registrarlo). Probar en tablet: instalar, publicar una versión nueva y ver el aviso.
- **Límite:** en iPhone y iPad el sistema puede borrar lo guardado de una web que no se usa por semanas; instalada en la pantalla de inicio es más estable.
