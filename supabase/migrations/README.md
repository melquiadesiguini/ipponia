# Migraciones

Archivos `AAAAMMDDHHMMSS_nombre.sql`, **en orden** y cada uno atómico (si algo falla, no queda nada a medias).
Lo que había antes de esta carpeta está en `../legacy/` (solo como historial, no se vuelve a ejecutar).

## Cómo aplicar una migración
1. Supabase > SQL Editor > New query > pegar el archivo completo > Run.
2. O, con el proyecto vinculado: `npx supabase db push`.

**Ojo con las tildes y la ñ.** Si copiás el archivo con PowerShell, leelo como UTF-8; si no, los acentos llegan rotos a la base (`DueÃ±o`):
```powershell
Set-Clipboard -Value ([System.IO.File]::ReadAllText("rutarchivo.sql", [System.Text.Encoding]::UTF8))
```

## Cómo probarlas antes (sin tocar Supabase)
```bash
npm run test:db
```
Levanta un PostgreSQL en memoria, carga el esquema anterior con datos de ejemplo, aplica **todas** las
migraciones y comprueba que los datos se migraron, que una organización no ve ni modifica nada de otra
(RLS) y que `tiene_permiso` respeta torneo, área, plan y estado de la organización.
Cada migración nueva debe sumar sus pruebas en `../tests/ejecutar.mjs`.

El modo sin conexión (cola de resultados y service worker) se prueba aparte, sin base de datos:
```bash
npm run test:offline
```

## Resultados
Desde `20261015120000` los resultados están en `resultados_jurado` (Kata, Kobudo, Destreza) y `resultados_kumite`, con columnas reales. La tabla anterior quedó como `resultados_archivo`.
Desde `20261019120000` un resultado puede llegar tarde (cargado sin conexión) con su hora y su torneo originales: ver la sección 19 de `PLAN-SAAS.md`.
