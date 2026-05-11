import z from 'zod/v4'
import { dockerListMetaSchema } from '../common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerContainerSchema,
  dockerDeploymentSnapshotSchema,
  dockerServiceSnapshotSchema,
} from '../containers'
import { dockerNetworkSchema } from '../networks'
import { dockerVolumeSchema } from '../volumes'
import { dockerRegistrySchema } from '../registries'
import { dockerStackSchema } from '../stacks'
import { dockerImageSchema } from './base.schema'

export const dockerImageListSchema = z.object({
  data: z.array(z.lazy(() => dockerImageSchema)),
  meta: dockerListMetaSchema,
})
export type DockerImageList = z.infer<typeof dockerImageListSchema>

export const dockerImageRelationsSchema = z.object({
  registry: z.lazy(() => dockerRegistrySchema).nullable().optional(),
  containers: z.array(z.lazy(() => dockerContainerSchema)).optional(),
  deployments: z.array(z.lazy(() => dockerDeploymentSnapshotSchema)).optional(),
  services: z.array(z.lazy(() => dockerServiceSnapshotSchema)).optional(),
  projects: z.array(z.lazy(() => dockerContainerProjectRefSchema)).optional(),
  networks: z.array(z.lazy(() => dockerNetworkSchema)).optional(),
  volumes: z.array(z.lazy(() => dockerVolumeSchema)).optional(),
  stacks: z.array(z.lazy(() => dockerStackSchema)).optional(),
  parent: z.lazy(() => dockerImageSchema).nullable().optional(),
  children: z.array(z.lazy(() => dockerImageSchema)).optional(),
})
export type DockerImageRelations = z.infer<typeof dockerImageRelationsSchema>

export const dockerImageEntitySchema = dockerImageSchema.extend({
  relations: dockerImageRelationsSchema.optional(),
})
export type DockerImageEntity = z.infer<typeof dockerImageEntitySchema>

export const dockerImageEntityListSchema = z.object({
  data: z.array(dockerImageEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerImageEntityList = z.infer<typeof dockerImageEntityListSchema>
