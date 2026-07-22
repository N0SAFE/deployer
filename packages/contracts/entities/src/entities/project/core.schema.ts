import z from 'zod/v4'
import {
  deploymentStatusSchema as commonDeploymentStatusSchema,
} from '@repo/contracts-common'
import { projectSettingsSchema } from './settings.schema'

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  baseDomain: z.string().nullable(),
  ownerId: z.string(),
  settings: projectSettingsSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Extended project with aggregated stats — used by findById */
export const projectWithStatsSchema = projectSchema.extend({
  _count: z.object({
    services: z.number(),
    deployments: z.number(),
    collaborators: z.number(),
  }),
  latestDeployment: z
    .object({
      id: z.string(),
      status: commonDeploymentStatusSchema,
      createdAt: z.string(),
    })
    .nullable(),
})
