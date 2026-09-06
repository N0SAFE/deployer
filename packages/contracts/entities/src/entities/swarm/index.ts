/**
 * @fileoverview Swarm entity schemas — canonical Zod contracts for Swarm mode.
 *
 * Layers:
 * - `dockerode.schema.ts` — raw engine responses (parse boundary at DockerService)
 * - `service.spec.schema.ts` — the deployable spec the platform builds
 * - `inspect.schema.ts` — platform-facing service/node/task/secret/config snapshots
 * - `cluster.schema.ts` — platform cluster state (inventory/election/membership)
 */

export * from './dockerode.schema'
export * from './service.spec.schema'
export * from './inspect.schema'
export * from './cluster.schema'
export * from './compose-model.schema'