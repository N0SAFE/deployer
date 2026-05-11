import z from 'zod/v4'
import {
  envNameSchema,
  environmentStatusSchema as commonEnvironmentStatusSchema,
} from '@repo/contracts-common'

export const environmentTypeSchema = envNameSchema
export const environmentStatusSchema = commonEnvironmentStatusSchema

export const projectEnvironmentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  type: environmentTypeSchema,
  status: environmentStatusSchema,
  isActive: z.boolean(),
  domainConfig: z
    .object({
      baseDomain: z.string().optional(),
      subdomain: z.string().optional(),
      customDomain: z.string().optional(),
      sslEnabled: z.boolean().optional(),
    })
    .nullable(),
  deploymentConfig: z
    .object({
      autoDeployEnabled: z.boolean().optional(),
      deploymentStrategy: z.enum(['rolling', 'blue-green', 'canary', 'recreate']).optional(),
      maxInstances: z.number().optional(),
      deployTimeoutMinutes: z.number().optional(),
    })
    .nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
