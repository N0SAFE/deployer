import z from 'zod/v4'
import { dockerListMetaSchema } from '../common.schema'
import { dockerImageSchema } from '../images'
import { dockerNetworkSchema } from '../networks'
import { dockerVolumeSchema } from '../volumes'
import { dockerRegistrySchema } from '../registries'
import { dockerStackSchema } from '../stacks'
import { dockerContainerSchema } from './base.schema'
import {
  dockerContainerProjectRefSchema,
  dockerDeploymentSnapshotSchema,
  dockerServiceSnapshotSchema,
} from './snapshots.schema'

export const dockerContainerListSchema = z.object({
  data: z.array(dockerContainerSchema),
  meta: dockerListMetaSchema,
})
export type DockerContainerList = z.infer<typeof dockerContainerListSchema>

export const dockerContainerRelationsSchema = z.object({
  deployment: z.lazy(() => dockerDeploymentSnapshotSchema).nullable().optional(),
  service: z.lazy(() => dockerServiceSnapshotSchema).nullable().optional(),
  project: z.lazy(() => dockerContainerProjectRefSchema).nullable().optional(),
  image: z.lazy(() => dockerImageSchema).nullable().optional(),
  networks: z.array(z.lazy(() => dockerNetworkSchema)).optional(),
  volumes: z.array(z.lazy(() => dockerVolumeSchema)).optional(),
  stack: z.lazy(() => dockerStackSchema).nullable().optional(),
  registry: z.lazy(() => dockerRegistrySchema).nullable().optional(),
  siblings: z.array(z.lazy(() => dockerContainerSchema)).optional(),
})
export type DockerContainerRelations = z.infer<typeof dockerContainerRelationsSchema>

export const dockerContainerEntitySchema = dockerContainerSchema.extend({
  relations: dockerContainerRelationsSchema.optional(),
})
export type DockerContainerEntity = z.infer<typeof dockerContainerEntitySchema>

export const dockerContainerEntityListSchema = z.object({
  data: z.array(dockerContainerEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerContainerEntityList = z.infer<typeof dockerContainerEntityListSchema>