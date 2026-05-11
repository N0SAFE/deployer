import z from 'zod/v4'
import { deploymentEnvironmentSchema } from '@repo/contracts-common'
import {
  dockerContainerHealthSchema,
  dockerContainerStatusSchema,
} from '../common.schema'

export const dockerPortBindingSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535).nullable(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})
export type DockerPortBinding = z.infer<typeof dockerPortBindingSchema>

export const dockerContainerManagedBySchema = z.enum(['deployment_service', 'orphan'])
export type DockerContainerManagedBy = z.infer<typeof dockerContainerManagedBySchema>

export const dockerContainerSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
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
  managedBy: dockerContainerManagedBySchema.default('orphan'),
  managedReason: z.string().min(1).nullable().default(null),
  managedDeploymentId: z.string().min(1).nullable().default(null),
  managedServiceId: z.string().min(1).nullable().default(null),
  managedProjectId: z.string().min(1).nullable().default(null),
  managedImageRef: z.string().min(1).nullable().default(null),
  managedNetworkMode: z.string().min(1).nullable().default(null),
  logsStreamId: z.string().nullable(),
  startedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerContainer = z.infer<typeof dockerContainerSchema>