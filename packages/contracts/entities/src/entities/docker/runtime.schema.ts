import z from 'zod/v4'
import { dockerListMetaSchema } from '@repo/contracts-entities/entities/docker/common.schema'
import {
  dockerContainerRuntimeActionSchema,
  dockerContainerRuntimeEventSchema,
  dockerContainerEntitySchema,
  dockerDeploymentSnapshotSchema,
  dockerServiceSnapshotSchema,
} from '@repo/contracts-entities/entities/docker/containers/index'
import {
  dockerImageEntitySchema,
  dockerImageRuntimeActionSchema,
  dockerImageRuntimeEventSchema,
} from '@repo/contracts-entities/entities/docker/images/index'
import {
  dockerNetworkEntitySchema,
  dockerNetworkRuntimeActionSchema,
  dockerNetworkRuntimeEventSchema,
} from '@repo/contracts-entities/entities/docker/networks/index'
import {
  dockerVolumeEntitySchema,
  dockerVolumeRuntimeActionSchema,
  dockerVolumeRuntimeEventSchema,
} from '@repo/contracts-entities/entities/docker/volumes/index'
import { dockerRegistryEntitySchema } from '@repo/contracts-entities/entities/docker/registries/index'
import { dockerStackEntitySchema } from '@repo/contracts-entities/entities/docker/stacks/index'

export const dockerRuntimeEventSourceSchema = z.enum([
  'container',
  'image',
  'volume',
  'network',
  'daemon',
  'service',
  'node',
  'task',
  'secret',
  'config',
  'builder',
  'unknown',
])
export type DockerRuntimeEventSource = z.infer<typeof dockerRuntimeEventSourceSchema>

export const dockerDaemonRuntimeActionSchema = z.enum(['reload'])
export type DockerDaemonRuntimeAction = z.infer<typeof dockerDaemonRuntimeActionSchema>

export const dockerServiceRuntimeActionSchema = z.enum(['create', 'update', 'remove'])
export type DockerServiceRuntimeAction = z.infer<typeof dockerServiceRuntimeActionSchema>

export const dockerNodeRuntimeActionSchema = z.enum(['create', 'update', 'remove'])
export type DockerNodeRuntimeAction = z.infer<typeof dockerNodeRuntimeActionSchema>

/**
 * Swarm TASK actions.
 *
 * A task is a single scheduling attempt of a service's replicas, so these fire
 * from the orchestrator rather than from a container: `create` when the task is
 * allocated, `update` on every state transition (pending → assigned → running →
 * failed/complete), `remove` when it is reaped.
 *
 * NOTE: engine 29.8.1 emits NO `task` events (verified against the raw
 * `/events` socket with a crash-looping and a Pending service). The source is
 * modelled anyway so task-shaped activities have a real type to be built from —
 * the swarm activity enricher SYNTHESIZES them from live task state, which is
 * the only way the failure text is reachable.
 */
export const dockerTaskRuntimeActionSchema = z.enum(['create', 'update', 'remove'])
export type DockerTaskRuntimeAction = z.infer<typeof dockerTaskRuntimeActionSchema>

export const dockerSecretRuntimeActionSchema = z.enum(['create', 'update', 'remove'])
export type DockerSecretRuntimeAction = z.infer<typeof dockerSecretRuntimeActionSchema>

export const dockerConfigRuntimeActionSchema = z.enum(['create', 'update', 'remove'])
export type DockerConfigRuntimeAction = z.infer<typeof dockerConfigRuntimeActionSchema>

export const dockerBuilderRuntimeActionSchema = z.enum(['prune'])
export type DockerBuilderRuntimeAction = z.infer<typeof dockerBuilderRuntimeActionSchema>

export const dockerRuntimeKnownActionSchema = z.union([
  dockerContainerRuntimeActionSchema,
  dockerImageRuntimeActionSchema,
  dockerVolumeRuntimeActionSchema,
  dockerNetworkRuntimeActionSchema,
  dockerDaemonRuntimeActionSchema,
  dockerServiceRuntimeActionSchema,
  dockerNodeRuntimeActionSchema,
  dockerTaskRuntimeActionSchema,
  dockerSecretRuntimeActionSchema,
  dockerConfigRuntimeActionSchema,
  dockerBuilderRuntimeActionSchema,
])
export type DockerRuntimeKnownAction = z.infer<typeof dockerRuntimeKnownActionSchema>

const dockerRuntimeEventCommonSchema = z.object({
  type: z.literal('docker_event'),
  actorId: z.string().nullable(),
  actorAttributes: z.record(z.string(), z.string()).default({}),
  scope: z.string().nullable(),
  from: z.string().nullable(),
  eventId: z.string().nullable(),
  nodeId: z.string().nullable(),
  timestamp: z.string(),
  timestampNano: z.number().int().nonnegative().nullable(),
  raw: z.record(z.string(), z.unknown()),
})

export const dockerDaemonRuntimeEventPayloadSchema = z.object({
  daemonId: z.string().nullable(),
  daemonName: z.string().nullable(),
})
export type DockerDaemonRuntimeEventPayload = z.infer<typeof dockerDaemonRuntimeEventPayloadSchema>

export const dockerServiceRuntimeEventPayloadSchema = z.object({
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
})
export type DockerServiceRuntimeEventPayload = z.infer<typeof dockerServiceRuntimeEventPayloadSchema>

export const dockerNodeRuntimeEventPayloadSchema = z.object({
  swarmNodeId: z.string().nullable(),
  nodeName: z.string().nullable(),
})
export type DockerNodeRuntimeEventPayload = z.infer<typeof dockerNodeRuntimeEventPayloadSchema>

/**
 * Swarm task payload — the SCHEDULING view of a workload.
 *
 * This is where swarm failures actually live. A service event says only
 * "something changed about this service"; the task carries the outcome:
 *
 *   state:        pending | assigned | accepted | running | failed | complete
 *   desiredState: what the orchestrator wants (running/shutdown)
 *   error:        the operator-facing reason, e.g.
 *                 "no suitable node (host-mode port already in use on 1 node)"
 *                 "network sandbox join failed: … error creating vxlan interface: file exists"
 *
 * `serviceName` is denormalized so an activity can render without a join.
 */
export const dockerTaskRuntimeEventPayloadSchema = z.object({
  taskId: z.string().nullable(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  slot: z.number().int().nullable(),
  nodeId: z.string().nullable(),
  state: z.string().nullable(),
  desiredState: z.string().nullable(),
  error: z.string().nullable(),
})
export type DockerTaskRuntimeEventPayload = z.infer<typeof dockerTaskRuntimeEventPayloadSchema>

export const dockerSecretRuntimeEventPayloadSchema = z.object({
  secretId: z.string().nullable(),
  secretName: z.string().nullable(),
})
export type DockerSecretRuntimeEventPayload = z.infer<typeof dockerSecretRuntimeEventPayloadSchema>

export const dockerConfigRuntimeEventPayloadSchema = z.object({
  configId: z.string().nullable(),
  configName: z.string().nullable(),
})
export type DockerConfigRuntimeEventPayload = z.infer<typeof dockerConfigRuntimeEventPayloadSchema>

export const dockerBuilderRuntimeEventPayloadSchema = z.object({
  builderId: z.string().nullable(),
  builderName: z.string().nullable(),
})
export type DockerBuilderRuntimeEventPayload = z.infer<typeof dockerBuilderRuntimeEventPayloadSchema>

export const dockerUnknownRuntimeEventPayloadSchema = z.object({
  entityId: z.string().nullable(),
  entityName: z.string().nullable(),
})
export type DockerUnknownRuntimeEventPayload = z.infer<typeof dockerUnknownRuntimeEventPayloadSchema>

export const dockerDaemonRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('daemon'),
  action: dockerDaemonRuntimeActionSchema,
  payload: dockerDaemonRuntimeEventPayloadSchema,
})
export type DockerDaemonRuntimeEvent = z.infer<typeof dockerDaemonRuntimeEventSchema>

export const dockerServiceRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('service'),
  action: dockerServiceRuntimeActionSchema,
  payload: dockerServiceRuntimeEventPayloadSchema,
})
export type DockerServiceRuntimeEvent = z.infer<typeof dockerServiceRuntimeEventSchema>

export const dockerNodeRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('node'),
  action: dockerNodeRuntimeActionSchema,
  payload: dockerNodeRuntimeEventPayloadSchema,
})
export type DockerNodeRuntimeEvent = z.infer<typeof dockerNodeRuntimeEventSchema>

export const dockerTaskRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('task'),
  action: dockerTaskRuntimeActionSchema,
  payload: dockerTaskRuntimeEventPayloadSchema,
})
export type DockerTaskRuntimeEvent = z.infer<typeof dockerTaskRuntimeEventSchema>

export const dockerSecretRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('secret'),
  action: dockerSecretRuntimeActionSchema,
  payload: dockerSecretRuntimeEventPayloadSchema,
})
export type DockerSecretRuntimeEvent = z.infer<typeof dockerSecretRuntimeEventSchema>

export const dockerConfigRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('config'),
  action: dockerConfigRuntimeActionSchema,
  payload: dockerConfigRuntimeEventPayloadSchema,
})
export type DockerConfigRuntimeEvent = z.infer<typeof dockerConfigRuntimeEventSchema>

export const dockerBuilderRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('builder'),
  action: dockerBuilderRuntimeActionSchema,
  payload: dockerBuilderRuntimeEventPayloadSchema,
})
export type DockerBuilderRuntimeEvent = z.infer<typeof dockerBuilderRuntimeEventSchema>

export const dockerUnknownRuntimeEventSchema = dockerRuntimeEventCommonSchema.extend({
  source: z.literal('unknown'),
  action: z.string().min(1),
  payload: dockerUnknownRuntimeEventPayloadSchema,
})
export type DockerUnknownRuntimeEvent = z.infer<typeof dockerUnknownRuntimeEventSchema>

export const dockerKnownRuntimeEventSchema = z.discriminatedUnion('source', [
  dockerContainerRuntimeEventSchema,
  dockerImageRuntimeEventSchema,
  dockerVolumeRuntimeEventSchema,
  dockerNetworkRuntimeEventSchema,
  dockerDaemonRuntimeEventSchema,
  dockerServiceRuntimeEventSchema,
  dockerNodeRuntimeEventSchema,
  dockerTaskRuntimeEventSchema,
  dockerSecretRuntimeEventSchema,
  dockerConfigRuntimeEventSchema,
  dockerBuilderRuntimeEventSchema,
])
export type DockerKnownRuntimeEvent = z.infer<typeof dockerKnownRuntimeEventSchema>

export const dockerRuntimeEventSchema = z.discriminatedUnion('source', [
  dockerContainerRuntimeEventSchema,
  dockerImageRuntimeEventSchema,
  dockerVolumeRuntimeEventSchema,
  dockerNetworkRuntimeEventSchema,
  dockerDaemonRuntimeEventSchema,
  dockerServiceRuntimeEventSchema,
  dockerNodeRuntimeEventSchema,
  dockerTaskRuntimeEventSchema,
  dockerSecretRuntimeEventSchema,
  dockerConfigRuntimeEventSchema,
  dockerBuilderRuntimeEventSchema,
  dockerUnknownRuntimeEventSchema,
])
export type DockerRuntimeEvent = z.infer<typeof dockerRuntimeEventSchema>

export const dockerDeploymentListSchema = z.object({
  data: z.array(dockerDeploymentSnapshotSchema),
  meta: dockerListMetaSchema,
})
export type DockerDeploymentList = z.infer<typeof dockerDeploymentListSchema>

export const dockerServiceListSchema = z.object({
  data: z.array(dockerServiceSnapshotSchema),
  meta: dockerListMetaSchema,
})
export type DockerServiceList = z.infer<typeof dockerServiceListSchema>

export const dockerFleetServerStatusSchema = z.enum(['active', 'suspect', 'draining', 'revoked'])
export type DockerFleetServerStatus = z.infer<typeof dockerFleetServerStatusSchema>

export const dockerFleetServerMetricsSchema = z.object({
  cpuUsage: z.number().min(0).max(1),
  memoryUsage: z.number().min(0).max(1),
  activeStreams: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
  reportedAt: z.date(),
})
export type DockerFleetServerMetrics = z.infer<typeof dockerFleetServerMetricsSchema>

export const dockerFleetServerSchema = z.object({
  nodeId: z.string().min(1),
  serverUrl: z.string().min(1),
  displayName: z.string().nullable(),
  status: dockerFleetServerStatusSchema,
  healthy: z.boolean(),
  lastSeenAt: z.date().nullable(),
  maxCpuMillicores: z.number().int().min(0).nullable(),
  maxMemoryMb: z.number().int().min(0).nullable(),
  metrics: dockerFleetServerMetricsSchema.nullable(),
  allocationSummary: z.object({
    services: z.number().int().min(0),
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
  }),
})
export type DockerFleetServer = z.infer<typeof dockerFleetServerSchema>

export const dockerFleetServerListSchema = z.object({
  items: z.array(dockerFleetServerSchema),
})
export type DockerFleetServerList = z.infer<typeof dockerFleetServerListSchema>

export const dockerMeshEventStreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scope: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
})
export type DockerMeshEventStream = z.infer<typeof dockerMeshEventStreamSchema>

export const dockerMeshEventStreamListSchema = z.object({
  data: z.array(dockerMeshEventStreamSchema),
  meta: dockerListMetaSchema,
})
export type DockerMeshEventStreamList = z.infer<typeof dockerMeshEventStreamListSchema>

export const dockerMeshStateSchema = z.object({
  reason: z.string().min(1),
  peers: z.array(z.object({ id: z.string().min(1) })),
  sessions: z.array(z.object({ id: z.string().min(1) })),
  revision: z.number().int().min(0),
  emittedAt: z.string(),
})
export type DockerMeshState = z.infer<typeof dockerMeshStateSchema>

export const dockerLogSourceSchema = z.enum(['deployment', 'mesh'])
export type DockerLogSource = z.infer<typeof dockerLogSourceSchema>

export const dockerLogLineSchema = z.object({
  id: z.string().min(1),
  containerName: z.string().min(1),
  source: dockerLogSourceSchema,
  status: z.string().min(1),
  message: z.string().min(1),
  timestamp: z.string(),
})
export type DockerLogLine = z.infer<typeof dockerLogLineSchema>

export const dockerOperationProgressResourceTypeSchema = z.enum(['containers', 'images', 'networks', 'volumes', 'registry', 'stacks'])
export type DockerOperationProgressResourceType = z.infer<typeof dockerOperationProgressResourceTypeSchema>

export const dockerOperationProgressStatusSchema = z.enum(['queued', 'running', 'success', 'failed'])
export type DockerOperationProgressStatus = z.infer<typeof dockerOperationProgressStatusSchema>

export const dockerOperationProgressItemSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  resourceName: z.string().min(1),
  resourceType: dockerOperationProgressResourceTypeSchema,
  status: dockerOperationProgressStatusSchema,
  progress: z.number().int().min(0).max(100),
  updatedAt: z.string(),
})
export type DockerOperationProgressItem = z.infer<typeof dockerOperationProgressItemSchema>

export const dockerRuntimeActivityStatusSchema = z.enum(['queued', 'running', 'completed', 'error', 'info'])
export type DockerRuntimeActivityStatus = z.infer<typeof dockerRuntimeActivityStatusSchema>

export const dockerRuntimeActivityCategorySchema = z.enum(['image-scanning', 'runtime-event'])
export type DockerRuntimeActivityCategory = z.infer<typeof dockerRuntimeActivityCategorySchema>

export const dockerRuntimeActivitySeveritySchema = z.enum(['info', 'warning', 'error'])
export type DockerRuntimeActivitySeverity = z.infer<typeof dockerRuntimeActivitySeveritySchema>

/**
 * Swarm task state attached to an activity.
 *
 * WHY THIS IS A FIRST-CLASS FIELD AND NOT BURIED IN `payload`
 * Docker's swarm events carry NO state — a real one is just
 * `{"Type":"service","Action":"create","Actor":{"ID":"…"}}`. And the failure
 * reason an operator actually needs lives on the TASK, which the engine does not
 * emit as an event at all (verified: zero task events on engine 29.8.1 with a
 * crash-looping and a Pending service present).
 *
 * So the activity is enriched from a live read, and these are the columns that
 * read produces. `error` is the important one — it is literally what surfaced
 * "no suitable node (host-mode port already in use on 1 node)" for the ingress
 * conflict, and which is invisible in the raw event stream.
 */
export const dockerRuntimeActivitySwarmTaskSchema = z.object({
  taskId: z.string(),
  slot: z.number().int().nullable().default(null),
  state: z.string().default(''),
  desiredState: z.string().default(''),
  error: z.string().nullable().default(null),
})
export type DockerRuntimeActivitySwarmTask = z.infer<typeof dockerRuntimeActivitySwarmTaskSchema>

/** Service-level swarm state, when the activity is about a service. */
export const dockerRuntimeActivitySwarmServiceSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string().default(''),
  image: z.string().default(''),
  mode: z.string().default(''),
  desiredTasks: z.number().int().nonnegative().default(0),
  runningTasks: z.number().int().nonnegative().default(0),
  updateMessage: z.string().nullable().default(null),
})
export type DockerRuntimeActivitySwarmService = z.infer<typeof dockerRuntimeActivitySwarmServiceSchema>

export const dockerRuntimeActivityEntitySchema = z.object({
  id: z.string().min(1),
  eventId: z.string().nullable(),
  eventFingerprint: z.string().min(1),
  flowId: z.string().min(1),
  dependsOnFlowId: z.string().nullable(),
  source: dockerRuntimeEventSourceSchema,
  action: z.string().min(1),
  actorId: z.string().nullable(),
  status: dockerRuntimeActivityStatusSchema,
  category: dockerRuntimeActivityCategorySchema,
  severity: dockerRuntimeActivitySeveritySchema,
  progress: z.number().int().min(0).max(100).nullable(),
  stage: z.string().nullable(),
  scanner: z.string().nullable(),
  message: z.string().nullable(),
  actorAttributes: z.record(z.string(), z.string()),
  payload: z.record(z.string(), z.unknown()),
  raw: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Live swarm tasks at the moment of the read — empty for non-swarm sources.
   * Populated by the enricher because the engine emits no task events.
   */
  swarmTasks: z.array(dockerRuntimeActivitySwarmTaskSchema).default([]),
  /** Live service state, when the activity concerns a swarm service. */
  swarmService: dockerRuntimeActivitySwarmServiceSchema.nullable().default(null),
})
export type DockerRuntimeActivityEntity = z.infer<typeof dockerRuntimeActivityEntitySchema>

export const dockerRuntimeActivityEntityListSchema = z.object({
  data: z.array(dockerRuntimeActivityEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerRuntimeActivityEntityList = z.infer<typeof dockerRuntimeActivityEntityListSchema>

export const dockerRuntimeCatalogSchema = z.object({
  containers: z.array(z.lazy(() => dockerContainerEntitySchema)),
  images: z.array(z.lazy(() => dockerImageEntitySchema)),
  networks: z.array(z.lazy(() => dockerNetworkEntitySchema)),
  volumes: z.array(z.lazy(() => dockerVolumeEntitySchema)),
  registries: z.array(z.lazy(() => dockerRegistryEntitySchema)),
  stacks: z.array(z.lazy(() => dockerStackEntitySchema)),
})
export type DockerRuntimeCatalog = z.infer<typeof dockerRuntimeCatalogSchema>
