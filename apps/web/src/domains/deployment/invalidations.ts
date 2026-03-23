/**
 * Deployment Domain - Cache Invalidation Configuration
 */

import { defineInvalidations } from '../shared/helpers'
import { deploymentEndpoints } from './endpoints'

function resolveDeploymentId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as { id?: string; params?: { id?: string } }
  return c.id ?? c.params?.id
}

export const deploymentInvalidations = defineInvalidations(deploymentEndpoints, {
  trigger: ({ keys }) => [keys.list()],

  cancel: ({ input, keys }) => {
    const id = resolveDeploymentId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  rollback: ({ keys }) => [keys.list()],

  retry: ({ input, keys }) => {
    const id = resolveDeploymentId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  delete: ({ input, keys }) => {
    const id = resolveDeploymentId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },
})
