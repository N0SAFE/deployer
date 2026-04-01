import z from 'zod/v4'
import {
  deploymentEnvironmentSchema,
  deploymentStatusSchema,
  sourceTypeSchema,
} from '@repo/contracts-common'

export const dockerContainerStatusSchema = z.enum([
  'created',
  'running',
  'paused',
  'restarting',
  'exited',
  'dead',
  'unknown',
])
export type DockerContainerStatus = z.infer<typeof dockerContainerStatusSchema>

export const dockerContainerHealthSchema = z.enum(['healthy', 'unhealthy', 'starting', 'none'])
export type DockerContainerHealth = z.infer<typeof dockerContainerHealthSchema>

export const dockerNetworkDriverSchema = z.enum(['bridge', 'overlay', 'host', 'macvlan', 'ipvlan', 'custom'])
export type DockerNetworkDriver = z.infer<typeof dockerNetworkDriverSchema>

export const dockerNetworkScopeSchema = z.enum(['local', 'swarm', 'global'])
export type DockerNetworkScope = z.infer<typeof dockerNetworkScopeSchema>

export const dockerVolumeDriverSchema = z.enum(['local', 'nfs', 'csi', 'tmpfs', 'custom'])
export type DockerVolumeDriver = z.infer<typeof dockerVolumeDriverSchema>

export const dockerRegistryAuthModeSchema = z.enum(['anonymous', 'token', 'basic', 'oidc'])
export type DockerRegistryAuthMode = z.infer<typeof dockerRegistryAuthModeSchema>

export const dockerRegistryStatusSchema = z.enum(['healthy', 'degraded', 'offline', 'unknown'])
export type DockerRegistryStatus = z.infer<typeof dockerRegistryStatusSchema>

export const dockerStackStatusSchema = z.enum(['healthy', 'degraded', 'failed', 'provisioning', 'paused', 'unknown'])
export type DockerStackStatus = z.infer<typeof dockerStackStatusSchema>

export const dockerPortBindingSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535).nullable(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})
export type DockerPortBinding = z.infer<typeof dockerPortBindingSchema>

export const dockerImageSchema = z.object({
  id: z.string().min(1),
  registry: z.string().min(1),
  repository: z.string().min(1),
  tag: z.string().min(1).nullable(),
  digest: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
})
export type DockerImage = z.infer<typeof dockerImageSchema>

export const dockerVolumeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: dockerVolumeDriverSchema,
  mountpoint: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  usedByContainerIds: z.array(z.string().min(1)).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerVolume = z.infer<typeof dockerVolumeSchema>

export const dockerNetworkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: dockerNetworkDriverSchema,
  scope: dockerNetworkScopeSchema,
  internal: z.boolean().default(false),
  attachable: z.boolean().default(true),
  subnet: z.string().nullable(),
  gateway: z.string().nullable(),
  containerIds: z.array(z.string().min(1)).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerNetwork = z.infer<typeof dockerNetworkSchema>

export const dockerRegistrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  authMode: dockerRegistryAuthModeSchema,
  status: dockerRegistryStatusSchema,
  isPrimary: z.boolean().default(false),
  repositories: z.array(z.string().min(1)).default([]),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerRegistry = z.infer<typeof dockerRegistrySchema>

export const dockerStackServiceRefSchema = z.object({
  serviceId: z.string().min(1),
  imageId: z.string().min(1).nullable(),
  containerIds: z.array(z.string().min(1)).default([]),
  networkIds: z.array(z.string().min(1)).default([]),
  volumeIds: z.array(z.string().min(1)).default([]),
  replicas: z.number().int().min(0).default(0),
  desiredReplicas: z.number().int().min(0).default(0),
  status: dockerContainerStatusSchema,
})
export type DockerStackServiceRef = z.infer<typeof dockerStackServiceRefSchema>

export const dockerStackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  status: dockerStackStatusSchema,
  services: z.array(z.lazy(() => dockerStackServiceRefSchema)).default([]),
  networkIds: z.array(z.string().min(1)).default([]),
  volumeIds: z.array(z.string().min(1)).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerStack = z.infer<typeof dockerStackSchema>

export const dockerContainerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  serviceId: z.string().min(1),
  stackId: z.string().nullable(),
  imageId: z.string().nullable(),
  status: dockerContainerStatusSchema,
  health: dockerContainerHealthSchema,
  environment: deploymentEnvironmentSchema.nullable(),
  cpuPercent: z.number().min(0).max(100).nullable(),
  memoryPercent: z.number().min(0).max(100).nullable(),
  restartCount: z.number().int().min(0).default(0),
  ports: z.array(dockerPortBindingSchema).default([]),
  networkIds: z.array(z.string().min(1)).default([]),
  volumeIds: z.array(z.string().min(1)).default([]),
  logsStreamId: z.string().nullable(),
  startedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerContainer = z.infer<typeof dockerContainerSchema>

export const dockerListMetaSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
})
export type DockerListMeta = z.infer<typeof dockerListMetaSchema>

export const dockerServiceSnapshotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
  customDomains: z.array(z.string()).default([]),
  resourceLimits: z
    .object({
      storage: z.string().optional(),
    })
    .optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
})
export type DockerServiceSnapshot = z.infer<typeof dockerServiceSnapshotSchema>

export const dockerDeploymentSnapshotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  serviceId: z.string().min(1),
  environment: deploymentEnvironmentSchema,
  status: deploymentStatusSchema,
  sourceType: sourceTypeSchema,
  containerName: z.string().nullable(),
  containerImage: z.string().nullable(),
  healthCheckUrl: z.string().nullable(),
  domainUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerDeploymentSnapshot = z.infer<typeof dockerDeploymentSnapshotSchema>

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
  clusterId: z.string().min(1),
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
    organizations: z.number().int().min(0),
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
  }),
})
export type DockerFleetServer = z.infer<typeof dockerFleetServerSchema>

export const dockerMeshEventStreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  scope: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
})
export type DockerMeshEventStream = z.infer<typeof dockerMeshEventStreamSchema>

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

export const dockerImageSummarySchema = z.object({
  image: z.string().min(1),
  usageCount: z.number().int().min(0),
  successful: z.number().int().min(0),
  failed: z.number().int().min(0),
  lastSeenAt: z.string(),
})
export type DockerImageSummary = z.infer<typeof dockerImageSummarySchema>

export const dockerStackSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  serviceCount: z.number().int().min(0),
  activeServices: z.number().int().min(0),
  latestDeploymentStatus: z.string().nullable(),
  deploymentCount: z.number().int().min(0),
})
export type DockerStackSummary = z.infer<typeof dockerStackSummarySchema>

export const dockerVolumeSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  serviceName: z.string().min(1),
  projectId: z.string().min(1),
  storageLimit: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
})
export type DockerVolumeSummary = z.infer<typeof dockerVolumeSummarySchema>

export const dockerNetworkSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  serviceCount: z.number().int().min(0),
  activeServiceCount: z.number().int().min(0),
  exposedDomains: z.array(z.string()),
})
export type DockerNetworkSummary = z.infer<typeof dockerNetworkSummarySchema>

export const dockerRegistrySummarySchema = z.object({
  registry: z.string().min(1),
  repositoryCount: z.number().int().min(0),
  imageCount: z.number().int().min(0),
  lastSeenAt: z.string(),
  repositories: z.array(z.string()),
})
export type DockerRegistrySummary = z.infer<typeof dockerRegistrySummarySchema>

export const dockerFileEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'dir']),
  size: z.string().min(1),
  permissions: z.string().min(1),
  owner: z.string().min(1),
  updatedAt: z.string(),
})
export type DockerFileEntry = z.infer<typeof dockerFileEntrySchema>

export const dockerImageLayerEntrySchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  size: z.string().min(1),
  createdAt: z.string(),
})
export type DockerImageLayerEntry = z.infer<typeof dockerImageLayerEntrySchema>

export const dockerVulnerabilitySeveritySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type DockerVulnerabilitySeverity = z.infer<typeof dockerVulnerabilitySeveritySchema>

export const dockerVulnerabilityEntrySchema = z.object({
  id: z.string().min(1),
  severity: dockerVulnerabilitySeveritySchema,
  packageName: z.string().min(1),
  currentVersion: z.string().min(1),
  fixedVersion: z.string().nullable(),
  description: z.string().min(1),
})
export type DockerVulnerabilityEntry = z.infer<typeof dockerVulnerabilityEntrySchema>

export const dockerRegistryTagDetailSchema = z.object({
  name: z.string().min(1),
  digest: z.string().min(1),
  size: z.string().min(1),
  pushedAt: z.string(),
})
export type DockerRegistryTagDetail = z.infer<typeof dockerRegistryTagDetailSchema>

export const dockerRegistryRepositoryDetailSchema = z.object({
  repository: z.string().min(1),
  tags: z.array(dockerRegistryTagDetailSchema),
})
export type DockerRegistryRepositoryDetail = z.infer<typeof dockerRegistryRepositoryDetailSchema>

export const dockerStackActivityStatusSchema = z.enum(['success', 'failed', 'pending'])
export type DockerStackActivityStatus = z.infer<typeof dockerStackActivityStatusSchema>

export const dockerStackActivityEntrySchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  status: dockerStackActivityStatusSchema,
  timestamp: z.string(),
})
export type DockerStackActivityEntry = z.infer<typeof dockerStackActivityEntrySchema>

export const dockerNetworkDiagnosticsSchema = z.object({
  dnsResolution: z.enum(['ok', 'degraded']),
  connectivityScore: z.number().min(0).max(100),
  notes: z.array(z.string()),
})
export type DockerNetworkDiagnostics = z.infer<typeof dockerNetworkDiagnosticsSchema>

export const dockerContainerLogStreamSchema = z.enum(['stdout', 'stderr'])
export type DockerContainerLogStream = z.infer<typeof dockerContainerLogStreamSchema>

export const dockerContainerLogLevelSchema = z.enum(['info', 'warn', 'error'])
export type DockerContainerLogLevel = z.infer<typeof dockerContainerLogLevelSchema>

export const dockerContainerLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  stream: dockerContainerLogStreamSchema,
  level: dockerContainerLogLevelSchema,
  message: z.string().min(1),
})
export type DockerContainerLogEntry = z.infer<typeof dockerContainerLogEntrySchema>

export const dockerContainerMetricPointSchema = z.object({
  at: z.string(),
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  networkRxKb: z.number().min(0),
  networkTxKb: z.number().min(0),
  ioReadKb: z.number().min(0),
  ioWriteKb: z.number().min(0),
})
export type DockerContainerMetricPoint = z.infer<typeof dockerContainerMetricPointSchema>

export const dockerTerminalShellSchema = z.enum(['bash', 'sh', 'zsh', 'ash'])
export type DockerTerminalShell = z.infer<typeof dockerTerminalShellSchema>

export const dockerTerminalProfileSchema = z.object({
  shell: dockerTerminalShellSchema,
  user: z.string().min(1),
  workingDir: z.string().min(1),
  recommended: z.boolean(),
})
export type DockerTerminalProfile = z.infer<typeof dockerTerminalProfileSchema>

export const dockerContainerProcessStateSchema = z.enum(['running', 'sleeping', 'idle', 'stopped', 'zombie'])
export type DockerContainerProcessState = z.infer<typeof dockerContainerProcessStateSchema>

export const dockerContainerProcessEntrySchema = z.object({
  pid: z.number().int().nonnegative(),
  user: z.string().min(1),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
  state: dockerContainerProcessStateSchema,
  startedAt: z.string(),
  command: z.string().min(1),
})
export type DockerContainerProcessEntry = z.infer<typeof dockerContainerProcessEntrySchema>

export const dockerContainerPortMappingSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostIp: z.string().min(1),
  hostPort: z.number().int().min(1).max(65535).nullable(),
  protocol: z.enum(['tcp', 'udp']),
  url: z.string().nullable(),
})
export type DockerContainerPortMapping = z.infer<typeof dockerContainerPortMappingSchema>

export const dockerContainerNetworkAttachmentSchema = z.object({
  networkId: z.string().min(1),
  name: z.string().min(1),
  driver: dockerNetworkDriverSchema,
  scope: dockerNetworkScopeSchema,
  ipv4: z.string().nullable(),
  ipv6: z.string().nullable(),
  gateway: z.string().nullable(),
  macAddress: z.string().nullable(),
  aliases: z.array(z.string()),
  dnsServers: z.array(z.string()),
  dnsSearch: z.array(z.string()),
  dnsOptions: z.array(z.string()),
  extraHosts: z.array(z.string()),
})
export type DockerContainerNetworkAttachment = z.infer<typeof dockerContainerNetworkAttachmentSchema>

export const dockerContainerMountTypeSchema = z.enum(['bind', 'volume', 'tmpfs', 'npipe'])
export type DockerContainerMountType = z.infer<typeof dockerContainerMountTypeSchema>

export const dockerContainerMountEntrySchema = z.object({
  type: dockerContainerMountTypeSchema,
  mountName: z.string().nullable(),
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean(),
  propagation: z.string().nullable(),
  mode: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
})
export type DockerContainerMountEntry = z.infer<typeof dockerContainerMountEntrySchema>

export const dockerContainerEnvVarSourceSchema = z.enum(['image', 'compose', 'runtime', 'secret'])
export type DockerContainerEnvVarSource = z.infer<typeof dockerContainerEnvVarSourceSchema>

export const dockerContainerEnvVarEntrySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  masked: z.boolean(),
  source: dockerContainerEnvVarSourceSchema,
})
export type DockerContainerEnvVarEntry = z.infer<typeof dockerContainerEnvVarEntrySchema>

export const dockerContainerWatchModeSchema = z.enum(['disabled', 'nodemon', 'watchpack', 'vite', 'turbo', 'custom'])
export type DockerContainerWatchMode = z.infer<typeof dockerContainerWatchModeSchema>

export const dockerContainerRuntimeConfigSchema = z.object({
  user: z.string().nullable(),
  workingDir: z.string().nullable(),
  entrypoint: z.array(z.string()),
  command: z.array(z.string()),
  restartPolicy: z.string().min(1),
  restartMaxRetries: z.number().int().nonnegative().nullable(),
  privileged: z.boolean(),
  readOnlyRootFs: z.boolean(),
  oomKillDisable: z.boolean(),
  ipcMode: z.string().nullable(),
  pidMode: z.string().nullable(),
  networkMode: z.string().nullable(),
  cgroupnsMode: z.string().nullable(),
  watchMode: dockerContainerWatchModeSchema,
  healthcheckCommand: z.string().nullable(),
  healthcheckIntervalSec: z.number().int().positive().nullable(),
  healthcheckTimeoutSec: z.number().int().positive().nullable(),
  healthcheckRetries: z.number().int().positive().nullable(),
})
export type DockerContainerRuntimeConfig = z.infer<typeof dockerContainerRuntimeConfigSchema>

export const dockerComposeDependencyConditionSchema = z.enum([
  'service_started',
  'service_healthy',
  'service_completed_successfully',
])
export type DockerComposeDependencyCondition = z.infer<typeof dockerComposeDependencyConditionSchema>

export const dockerComposeDependencyEntrySchema = z.object({
  service: z.string().min(1),
  condition: dockerComposeDependencyConditionSchema,
  required: z.boolean(),
})
export type DockerComposeDependencyEntry = z.infer<typeof dockerComposeDependencyEntrySchema>

export const dockerContainerComposeConfigSchema = z.object({
  serviceName: z.string().nullable(),
  projectName: z.string().nullable(),
  composeFilePath: z.string().nullable(),
  dependsOn: z.array(dockerComposeDependencyEntrySchema),
  dns: z.array(z.string()),
  dnsSearch: z.array(z.string()),
  dnsOptions: z.array(z.string()),
  memLimitMb: z.number().int().positive().nullable(),
  memReservationMb: z.number().int().positive().nullable(),
  cpus: z.number().positive().nullable(),
  cpuShares: z.number().int().positive().nullable(),
  restart: z.string().nullable(),
  profiles: z.array(z.string()),
  ports: z.array(z.string()),
  volumes: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  rawYaml: z.string(),
})
export type DockerContainerComposeConfig = z.infer<typeof dockerContainerComposeConfigSchema>

export const dockerContainerInspectDetailSchema = z.object({
  containerId: z.string().min(1),
  generatedAt: z.string(),
  layers: z.array(dockerImageLayerEntrySchema),
  processes: z.array(dockerContainerProcessEntrySchema),
  streamingLogsSupported: z.boolean(),
  networkConfig: z.array(dockerContainerNetworkAttachmentSchema),
  portMappings: z.array(dockerContainerPortMappingSchema),
  mounts: z.array(dockerContainerMountEntrySchema),
  environment: z.array(dockerContainerEnvVarEntrySchema),
  runtimeConfig: dockerContainerRuntimeConfigSchema,
  composeConfig: dockerContainerComposeConfigSchema.nullable(),
})
export type DockerContainerInspectDetail = z.infer<typeof dockerContainerInspectDetailSchema>

export const dockerStackGraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.string().min(1),
})
export type DockerStackGraphNode = z.infer<typeof dockerStackGraphNodeSchema>

export const dockerStackGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
})
export type DockerStackGraphEdge = z.infer<typeof dockerStackGraphEdgeSchema>

export const dockerStackServiceGraphSchema = z.object({
  nodes: z.array(dockerStackGraphNodeSchema),
  edges: z.array(dockerStackGraphEdgeSchema),
})
export type DockerStackServiceGraph = z.infer<typeof dockerStackServiceGraphSchema>

export const dockerStackLogLevelSchema = z.enum(['info', 'warn', 'error'])
export type DockerStackLogLevel = z.infer<typeof dockerStackLogLevelSchema>

export const dockerStackLogEntrySchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  level: dockerStackLogLevelSchema,
  message: z.string().min(1),
  timestamp: z.string(),
})
export type DockerStackLogEntry = z.infer<typeof dockerStackLogEntrySchema>

export const dockerStackGitWebhookStatusSchema = z.enum(['configured', 'missing', 'error'])
export type DockerStackGitWebhookStatus = z.infer<typeof dockerStackGitWebhookStatusSchema>

export const dockerStackGitSyncStateSchema = z.object({
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1),
  lastCommit: z.string().min(1),
  lastSyncAt: z.string(),
  autoDeployOnPush: z.boolean(),
  webhookStatus: dockerStackGitWebhookStatusSchema,
})
export type DockerStackGitSyncState = z.infer<typeof dockerStackGitSyncStateSchema>

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

export const dockerContainerListSchema = z.object({
  data: z.array(dockerContainerSchema),
  meta: dockerListMetaSchema,
})
export type DockerContainerList = z.infer<typeof dockerContainerListSchema>

export const dockerImageListSchema = z.object({
  data: z.array(z.lazy(() => dockerImageSchema)),
  meta: dockerListMetaSchema,
})
export type DockerImageList = z.infer<typeof dockerImageListSchema>

export const dockerNetworkListSchema = z.object({
  data: z.array(z.lazy(() => dockerNetworkSchema)),
  meta: dockerListMetaSchema,
})
export type DockerNetworkList = z.infer<typeof dockerNetworkListSchema>

export const dockerVolumeListSchema = z.object({
  data: z.array(z.lazy(() => dockerVolumeSchema)),
  meta: dockerListMetaSchema,
})
export type DockerVolumeList = z.infer<typeof dockerVolumeListSchema>

export const dockerRegistryListSchema = z.object({
  data: z.array(z.lazy(() => dockerRegistrySchema)),
  meta: dockerListMetaSchema,
})
export type DockerRegistryList = z.infer<typeof dockerRegistryListSchema>

export const dockerStackListSchema = z.object({
  data: z.array(z.lazy(() => dockerStackSchema)),
  meta: dockerListMetaSchema,
})
export type DockerStackList = z.infer<typeof dockerStackListSchema>

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

export const dockerMeshEventStreamListSchema = z.object({
  data: z.array(dockerMeshEventStreamSchema),
  meta: dockerListMetaSchema,
})
export type DockerMeshEventStreamList = z.infer<typeof dockerMeshEventStreamListSchema>

export const dockerFleetServerListSchema = z.object({
  items: z.array(dockerFleetServerSchema),
})
export type DockerFleetServerList = z.infer<typeof dockerFleetServerListSchema>

export const dockerRuntimeCatalogSchema = z.object({
  containers: z.array(z.lazy(() => dockerContainerSchema)),
  images: z.array(z.lazy(() => dockerImageSchema)),
  networks: z.array(z.lazy(() => dockerNetworkSchema)),
  volumes: z.array(z.lazy(() => dockerVolumeSchema)),
  registries: z.array(z.lazy(() => dockerRegistrySchema)),
  stacks: z.array(z.lazy(() => dockerStackSchema)),
})
export type DockerRuntimeCatalog = z.infer<typeof dockerRuntimeCatalogSchema>