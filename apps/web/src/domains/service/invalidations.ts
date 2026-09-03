/**
 * Service Domain - Cache Invalidation Configuration
 */

import { defineInvalidations, type InvalidationConfig } from '../shared/helpers'
import { serviceEndpointOperations } from './endpoints'

function resolveServiceId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as { id?: string; params?: { id?: string } }
  return c.id ?? c.params?.id
}

export const serviceInvalidations: ReturnType<
  typeof defineInvalidations<typeof serviceEndpointOperations, InvalidationConfig<typeof serviceEndpointOperations>>
> = defineInvalidations(serviceEndpointOperations, {
  create: ({ keys }) => [keys.list()],

  update: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list(), keys.children({ input: { params: { id } } }), keys.subtree({ input: { params: { id } } })]
      : [keys.list()]
  },

  delete: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list(), keys.children({ input: { params: { id } } }), keys.subtree({ input: { params: { id } } })]
      : [keys.list()]
  },

  toggleActive: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  addDependency: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.getDependencies({ input: { params: { id } } })]
      : []
  },

  removeDependency: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.getDependencies({ input: { params: { id } } })]
      : []
  },

  updateNetwork: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.getNetwork({ input: { params: { id } } }), keys.findById({ input: { params: { id } } }), keys.list()]
      : []
  },

  provisionRecord: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.getNetwork({ input: { params: { id } } })]
      : []
  },
})
