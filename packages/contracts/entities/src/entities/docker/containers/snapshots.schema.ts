import z from 'zod/v4'
import {
  deploymentEnvironmentSchema,
  deploymentStatusSchema,
  sourceTypeSchema,
} from '@repo/contracts-common'

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

export const dockerContainerProjectRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseDomain: z.string().nullable(),
})
export type DockerContainerProjectRef = z.infer<typeof dockerContainerProjectRefSchema>