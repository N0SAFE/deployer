import { hostname } from 'node:os'

/**
 * This runtime's id among the replicas of the runtime service: one per process, named after the host it runs on, so it is
 * the same every time the process restarts and different on every node. The id it registers under is the id it excludes
 * when it asks the other nodes.
 */
export const runtimeReplicaId = (): string => `runtime-${hostname()}`
