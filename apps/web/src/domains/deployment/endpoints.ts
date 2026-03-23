import { orpc } from '@/lib/orpc'

/**
 * Deployment domain endpoints
 *
 * Core business-facing deployment operations via ORPC contracts.
 */
export const deploymentEndpoints = {
  // Core CRUD and lifecycle
  list: orpc.deployment.list,
  findById: orpc.deployment.findById,
  trigger: orpc.deployment.trigger,
  cancel: orpc.deployment.cancel,
  rollback: orpc.deployment.rollback,
  retry: orpc.deployment.retry,
  delete: orpc.deployment.delete,

  // Logs and history
  getLogs: orpc.deployment.getLogs,
  getRollbackHistory: orpc.deployment.getRollbackHistory,

  // Streaming
  stream: orpc.deployment.stream,
  streamService: orpc.deployment.streamService,
  streamQuery: orpc.deployment.streamQuery,
} as const

export type DeploymentEndpoints = typeof deploymentEndpoints
