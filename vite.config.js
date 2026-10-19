import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// Identificador único de cada compilación: la app lo compara con version.json
// para detectar que hay una versión nueva publicada.
const BUILD_ID = Date.now().toString()
const BASE = '/ipponia/'

function versionFile() {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ id: BUILD_ID }),
      })
    },
  }
}

// Todos los archivos de una carpeta, con ruta relativa y barras normales
function listarArchivos(carpeta, raiz = carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre)
    return statSync(ruta).isDirectory() ? listarArchivos(ruta, raiz) : [relative(raiz, ruta).split(sep).join('/')]
  })
}

// Genera sw.js (service worker) al terminar la compilación, con la lista de archivos de ESTA versión.
// Sirve para que la app abra sin internet (modo sin conexión). Ver public/sw.plantilla.js.
function serviceWorker() {
  let salida
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      salida = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const noPublicar = ['sw.js', 'sw.plantilla.js', 'version.json', '404.html']
      const archivos = listarArchivos(salida).filter((f) => !noPublicar.includes(f) && !f.endsWith('.map'))
      const plantilla = readFileSync(join(salida, 'sw.plantilla.js'), 'utf8')
      const codigo = plantilla
        .replace('__CACHE__', `ipponia-${BUILD_ID}`)
        .replace('__BASE__', BASE)
        .replace("'__ARCHIVOS__'", JSON.stringify(archivos.map((f) => BASE + f)))
      writeFileSync(join(salida, 'sw.js'), codigo)
      rmSync(join(salida, 'sw.plantilla.js')) // la plantilla no hace falta publicarla
    },
  }
}

export default defineConfig({
  plugins: [react(), versionFile(), serviceWorker()],
  base: BASE,
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
