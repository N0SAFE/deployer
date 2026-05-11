import { orpc } from '@/lib/orpc'

/**
 * Service domain endpoints
 *
 * All service endpoints use ORPC contracts directly.
 */
export const serviceEndpoints = {
  crud: {
    list: orpc.service.crud.list,
    findById: orpc.service.crud.findById,
    create: orpc.service.crud.create,
    update: orpc.service.crud.update,
    delete: orpc.service.crud.delete,
  },
  lifecycle: {
    toggleActive: orpc.service.lifecycle.toggleActive,
  },
  dependencies: {
    list: orpc.service.dependencies.list,
    add: orpc.service.dependencies.add,
    remove: orpc.service.dependencies.remove,
  },
  streams: {
    query: orpc.service.streams.query,
  },
} as const

export const serviceEndpointOperations = {
  list: serviceEndpoints.crud.list,
  findById: serviceEndpoints.crud.findById,
  create: serviceEndpoints.crud.create,
  update: serviceEndpoints.crud.update,
  delete: serviceEndpoints.crud.delete,
  toggleActive: serviceEndpoints.lifecycle.toggleActive,
  getDependencies: serviceEndpoints.dependencies.list,
  addDependency: serviceEndpoints.dependencies.add,
  removeDependency: serviceEndpoints.dependencies.remove,
  streamQuery: serviceEndpoints.streams.query,
} as const

export type ServiceEndpoints = typeof serviceEndpoints
