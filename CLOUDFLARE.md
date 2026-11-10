# Publicar IPPONIA en Cloudflare

IPPONIA se publica como un proyecto de **Cloudflare Pages** llamado `ipponia`, con la dirección gratuita
**`https://ipponia.pages.dev`**. Cloudflare compila el proyecto cada vez que se sube algo a la rama `main` de GitHub y lo sirve
desde su red mundial. No hace falta generar `docs/` ni compilar a mano.

Archivos del proyecto que lo hacen posible:

| Archivo | Para qué sirve |
|---|---|
| `wrangler.jsonc` | Declara el proyecto de Pages (nombre y carpeta publicada: `dist/`). |
| `public/_headers` | Cabeceras de seguridad (CSP, HSTS, no permitir que otro sitio la meta en un marco, etc.) y de caché. Cloudflare lo lee; no se sirve como archivo. |
| `vite.config.js` | Compila para la raíz del sitio (`/`) y genera el service worker del modo sin conexión. |

**Importante:** el proyecto **no debe tener `404.html`**. Mientras no exista, Pages entrega la app (`index.html`, estado 200) para cualquier
dirección que no sea un archivo, por ejemplo `/kumite` o `/mi-club/ingresar`. Con un `404.html` esas direcciones devolverían error.

## Configuración en Cloudflare (ya hecha una vez)

- **Workers & Pages → ipponia → Settings.**
- **Build command:** `npm run build` · **Build output directory:** `dist` · **Production branch:** `main` · Root directory: vacío.
- **Variables de compilación:** los valores públicos (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_SITE_URL`) están en el archivo
  **`.env.production`** del repositorio, que Vite lee solo al hacer `npm run build`. Se hizo así porque las variables cargadas en el
  panel de Cloudflare no llegaron a la compilación y esto no depende del panel.
  - Son **públicos por diseño** (la URL y la clave `publishable`/`anon` van dentro del JavaScript que baja cualquier navegador; lo que
    protege los datos son las reglas de Supabase). **Nunca poner ahí la clave `service_role` ni una `secret`.**
  - Si algún día se cambia el proyecto de Supabase o la dirección del sitio, se edita ese archivo y se sube a `main`.
  - Las variables que se carguen en el panel de Cloudflare mandan sobre este archivo. En tu computadora manda tu `.env.local`.
  - `VITE_BASE` (que se había cargado en el panel) ya no se usa: se puede borrar.

## En Supabase (una vez, con la dirección nueva)

1. **Authentication → URL Configuration:** poner `https://ipponia.pages.dev` como **Site URL** y agregar `https://ipponia.pages.dev/**` a
   **Redirect URLs**. Sin esto, los mails de invitación y de recuperación de contraseña llevan a la dirección vieja.
2. **Edge Functions → Secrets:**
   - `ORIGENES_PERMITIDOS` = `https://ipponia.pages.dev,http://localhost:5183,http://localhost:5173`
     (mientras convivan las dos direcciones, sumar también `https://melquiadesiguini.github.io`). Sin esto, el navegador bloquea
     las altas de organizaciones y de usuarios.
   - `SITIO_URL` = `https://ipponia.pages.dev`

## Direcciones

| Para qué | Dirección |
|---|---|
| Ingreso del dueño o administrador (con email) | `https://ipponia.pages.dev/ingresar` |
| Usuarios de una organización | `https://ipponia.pages.dev/<identificador>/ingresar` (por ejemplo `/ikigai-dojo/ingresar`) |
| Pantalla pública | `https://ipponia.pages.dev/pantalla` |
| Probar en tu computadora | `http://localhost:5183/` (`npm run dev`) |

## Repositorio privado

Cuando el sitio nuevo ande bien:

1. GitHub → el repositorio → *Settings* → *General* → *Danger Zone* → **Change visibility → Make private**.
2. GitHub → *Settings* → *Applications* → **Cloudflare Workers & Pages** → *Configure* → en *Repository access* verificar que
   el repositorio `ipponia` esté incluido (así Cloudflare sigue pudiendo compilarlo).
3. **GitHub Pages deja de publicarse** al pasar a privado (el plan gratis no lo permite). Es lo esperado: desde ese momento el sitio
   vive solo en Cloudflare, y la carpeta `docs/` ya no hace falta.

## Día a día

- **Publicar:** subir a `main` (`git push`). Cloudflare compila y publica solo.
- **Volver atrás:** Cloudflare → *ipponia* → *Deployments* → elegir una versión anterior → *Rollback to this deployment*.
- **Probar en tu computadora:** `npm run dev` → `http://localhost:5183/`.
- **Probar lo que va a publicar Cloudflare, con las cabeceras reales:** `npm run build` y después `npx wrangler pages dev dist`
  (abre `http://127.0.0.1:8788`).
- **Direcciones de los clientes:** cambian a la dirección nueva. El botón 📋 de *Configuración → Organizaciones* ya copia las
  direcciones del sitio donde estés parado.

## Qué protege y qué no

- **No se puede ocultar el código de la pantalla**: cualquier sitio entrega su JavaScript al navegador (está compilado y minificado,
  pero se puede leer). Lo que protege los datos son las reglas de Supabase (RLS), los permisos y las funciones del servidor.
- **Sí se protege**: el código fuente original, las pruebas y el historial (repositorio privado), y el sitio contra ataques comunes
  (cabeceras de seguridad y la red de Cloudflare).
- La política de contenido (`Content-Security-Policy` en `public/_headers`) solo deja ejecutar código de este mismo sitio y solo
  permite hablar con Supabase. **Si algún día se suma otro servicio (por ejemplo, un procesador de pagos), hay que agregar su
  dirección ahí.**
