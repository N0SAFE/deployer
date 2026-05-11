import z from 'zod/v4'
import { dockerContainerStatusSchema } from '../common.schema'

export const dockerStackStatusSchema = z.enum(['healthy', 'degraded', 'failed', 'provisioning', 'paused', 'unknown'])
export type DockerStackStatus = z.infer<typeof dockerStackStatusSchema>

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