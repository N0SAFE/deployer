/**
 * Service Domain - Cache Invalidation Configuration
 */

import { defineInvalidations } from '../shared/helpers'
import { serviceEndpoints } from './endpoints'

function resolveServiceId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as { id?: string; params?: { id?: string } }
  return c.id ?? c.params?.id
}

export const serviceInvalidations = defineInvalidations(serviceEndpoints, {
  create: ({ keys }) => [keys.list()],

  update: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  delete: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
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
      ? [keys.getDependencies({ input: { id } })]
      : []
  },

  removeDependency: ({ input, keys }) => {
    const id = resolveServiceId(input)
    return id
      ? [keys.getDependencies({ input: { id } })]
      : []
  },
})
