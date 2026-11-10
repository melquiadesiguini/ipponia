# Edge Functions

| Función | Quién puede | Qué hace |
|---|---|---|
| `crear-organizacion` | superadmin | Alta de un cliente: organización, roles de fábrica y dueño (con contraseña inicial o por invitación de email). |
| `crear-usuario` | permiso `gestionar_usuarios` | Crea un usuario interno (usuario + contraseña, cuenta ya confirmada, sin email real). |
| `resetear-clave` | permiso `gestionar_usuarios` | Pone una contraseña nueva a un usuario interno, le cierra las sesiones y lo obliga a cambiarla. |
| `desactivar-usuario` | permiso `gestionar_usuarios` | Desactiva o reactiva (`activo: true/false`) un usuario; no se borra. |

Todas: `POST` con `Authorization: Bearer <JWT del usuario>` y cuerpo JSON. Responden `{ "ok": true, ... }` o
`{ "ok": false, "error": "mensaje para el usuario" }`.

## Reglas de seguridad (ver `_shared/acciones.ts`)
- La organización sale **del perfil de quien llama**, nunca del cuerpo de la solicitud.
- Los permisos los evalúa la base (`tiene_permiso`) con el JWT de quien llama; recién después se usa la service role.
- La service role (`SUPABASE_SERVICE_ROLE_KEY`) existe solo en el servidor de Supabase; no está en el repo ni en el frontend.
- Un usuario de otra organización responde igual que uno inexistente (404), para no revelar quién existe.
- No se puede resetear ni desactivar al dueño ni a uno mismo; la organización debe estar vigente.
- Límite de 30 acciones de cada tipo cada 10 minutos por persona; todo queda en la tabla `auditoria`.
- Si algo falla a mitad de camino se deshace (no quedan cuentas sin perfil ni organizaciones sin dueño).

## Pruebas
```bash
npm run test:functions   # lógica con un servicio simulado (Deno vía npx)
npm run test:db          # base de datos real en memoria (PGlite)
```

## Publicar (una sola vez: `npx supabase login`)
```bash
npx supabase functions deploy crear-organizacion crear-usuario resetear-clave desactivar-usuario --project-ref owfjaphsqcpfdjessjbp
```
Variables opcionales (`npx supabase secrets set NOMBRE=valor --project-ref ...`):
- `ORIGENES_PERMITIDOS`: sitios que pueden llamar, separados por coma y con la dirección completa (por defecto `github.io` y `localhost`). **Con Cloudflare hay que cargarla** con la dirección del sitio nuevo y las de `localhost` (ver `CLOUDFLARE.md`).
- `SITIO_URL`: dirección del sitio para los enlaces de invitación (por defecto `https://melquiadesiguini.github.io/ipponia`). **Con Cloudflare hay que cargarla** con la dirección del sitio nuevo, sin barra final.

## Ojo con el email
Las invitaciones por email (y la recuperación de contraseña del dueño) necesitan un servidor de correo.
El de Supabase por defecto envía muy pocos mails por hora y solo a miembros del equipo del proyecto.
Para clientes reales hay que configurar un SMTP propio (Authentication > SMTP Settings; por ejemplo Resend).
Mientras tanto, `crear-organizacion` permite dar al dueño una **contraseña inicial** (sin mail).
