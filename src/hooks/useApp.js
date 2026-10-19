import { useSyncExternalStore } from 'react'
import { hayVersionNueva, suscribirActualizacion } from '../lib/serviceWorker'
import { estadoInstalacion, suscribirInstalacion } from '../lib/instalacion'

// ¿Hay una versión nueva de la app esperando para activarse?
export function useVersionNueva() {
  return useSyncExternalStore(suscribirActualizacion, hayVersionNueva)
}

// Estado de la instalación como app: { puedeInstalar, instalada, esApple }
export function useInstalacion() {
  return useSyncExternalStore(suscribirInstalacion, estadoInstalacion)
}
