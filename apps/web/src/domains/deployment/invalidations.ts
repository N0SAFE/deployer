/**
 * Deployment Domain - Cache Invalidation Configuration
 */

import { defineInvalidations, type InvalidationConfig } from '../shared/helpers'
import { deploymentEndpoints } from './endpoints'

function resolveDeploymentId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as { id?: string; params?: { id?: string } }
  return c.id ?? c.params?.id
}

export const deploymentInvalidations: ReturnType<
  typeof defineInvalidations<typeof deploymentEndpoints, InvalidationConfig<typeof deploymentEndpoints>>
> = defineInvalidations(deploymentEndpoints, {
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

  promoteServicePreview: ({ input, keys }) => {
    const serviceId = (input as { params?: { serviceId?: string } }).params?.serviceId
    if (!serviceId) return []
    return [keys.listServicePreviews({ input: { params: { serviceId } } })]
  },
})
