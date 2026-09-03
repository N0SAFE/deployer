import { orpc } from '@/lib/orpc'

/**
 * Managed-web console ops — the web app's BEAUTIFUL visual of the single
 * console URL (`/manage/web-app`). Traefik routes that path to this app when
 * the managed web is enabled; when it is stopped, the SAME URL falls back to
 * the API HTML console. Both visuals share one backend service.
 */
export const managedWebEndpoints = {
  getState: orpc.platform.getManagedWebState,
  toggle: orpc.platform.toggleManagedWeb,
  restart: orpc.platform.restartManagedWeb,
  setOrigin: orpc.platform.setManagedWebOrigin,
  enableTunnel: orpc.platform.enableManagedWebTunnel,
  disableTunnel: orpc.platform.disableManagedWebTunnel,
} as const

export const managedWebEndpointOperations = {
  // Queries included so their keys are available to invalidation configs.
  getState: managedWebEndpoints.getState,
  toggle: managedWebEndpoints.toggle,
  restart: managedWebEndpoints.restart,
  setOrigin: managedWebEndpoints.setOrigin,
  enableTunnel: managedWebEndpoints.enableTunnel,
  disableTunnel: managedWebEndpoints.disableTunnel,
}

export type ManagedWebEndpoints = typeof managedWebEndpoints