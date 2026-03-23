import { orpc } from '@/lib/orpc'

/**
 * Service domain endpoints
 *
 * All service endpoints use ORPC contracts directly.
 */
export const serviceEndpoints = {
  list: orpc.service.list,
  findById: orpc.service.findById,
  create: orpc.service.create,
  update: orpc.service.update,
  delete: orpc.service.delete,
  toggleActive: orpc.service.toggleActive,
  getDependencies: orpc.service.getDependencies,
  addDependency: orpc.service.addDependency,
  removeDependency: orpc.service.removeDependency,
  streamQuery: orpc.service.streamQuery,
} as const

export type ServiceEndpoints = typeof serviceEndpoints
