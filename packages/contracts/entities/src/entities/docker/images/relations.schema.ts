import z from 'zod/v4'
import { dockerListMetaSchema } from '@deployer/contracts-entities/entities/docker/common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerContainerSchema,
  dockerDeploymentSnapshotSchema,
  dockerServiceSnapshotSchema,
} from '@deployer/contracts-entities/entities/docker/containers/index'
import { dockerNetworkSchema } from '@deployer/contracts-entities/entities/docker/networks/index'
import { dockerVolumeSchema } from '@deployer/contracts-entities/entities/docker/volumes/index'
import { dockerRegistrySchema } from '@deployer/contracts-entities/entities/docker/registries/index'
import { dockerStackSchema } from '@deployer/contracts-entities/entities/docker/stacks/index'
import { dockerImageSchema } from '@deployer/contracts-entities/entities/docker/images/base.schema'

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
