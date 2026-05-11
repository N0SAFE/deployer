import z from 'zod/v4'
import { dockerImageLayerEntrySchema } from '../images'
import {
  dockerNetworkDriverSchema,
  dockerNetworkScopeSchema,
} from '../networks'
import {
  dockerContainerProcessEntrySchema,
} from './processes.schema'
import {
  dockerFileEntrySchema,
} from './logs.schema'

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