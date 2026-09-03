import { managedWebEndpoints } from './endpoints'
import type { InvalidationConfig } from '../shared/helpers'

type ManagedWebEndpoints = typeof managedWebEndpoints

export const managedWebInvalidations: InvalidationConfig<ManagedWebEndpoints> = {
  // Every mutation converges the platform (Traefik console route flips the
  // visual + container env restarts) — always refresh the full state.
  toggle: ({ keys }) => [keys.getState({ input: {} })],
  restart: ({ keys }) => [keys.getState({ input: {} })],
  setOrigin: ({ keys }) => [keys.getState({ input: {} })],
  enableTunnel: ({ keys }) => [keys.getState({ input: {} })],
  disableTunnel: ({ keys }) => [keys.getState({ input: {} })],
}