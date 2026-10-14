import z from 'zod/v4'
import { dockerListMetaSchema } from '@deployer/contracts-entities/entities/docker/common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerContainerSchema,
  dockerServiceSnapshotSchema,
} from '@deployer/contracts-entities/entities/docker/containers/index'
import { dockerImageSchema } from '@deployer/contracts-entities/entities/docker/images/index'
import { dockerNetworkSchema } from '@deployer/contracts-entities/entities/docker/networks/index'
import { dockerStackSchema } from '@deployer/contracts-entities/entities/docker/stacks/index'
import { dockerVolumeSchema } from '@deployer/contracts-entities/entities/docker/volumes/base.schema'

export const dockerVolumeListSchema = z.object({
  data: z.array(z.lazy(() => dockerVolumeSchema)),
  meta: dockerListMetaSchema,
})
export type DockerVolumeList = z.infer<typeof dockerVolumeListSchema>

export const dockerVolumeRelationsSchema = z.object({
  containers: z.array(z.lazy(() => dockerContainerSchema)).optional(),
  services: z.array(z.lazy(() => dockerServiceSnapshotSchema)).optional(),
  projects: z.array(z.lazy(() => dockerContainerProjectRefSchema)).optional(),
  stacks: z.array(z.lazy(() => dockerStackSchema)).optional(),
  images: z.array(z.lazy(() => dockerImageSchema)).optional(),
  networks: z.array(z.lazy(() => dockerNetworkSchema)).optional(),
})
export type DockerVolumeRelations = z.infer<typeof dockerVolumeRelationsSchema>

export const dockerVolumeEntitySchema = dockerVolumeSchema.extend({
  relations: dockerVolumeRelationsSchema.optional(),
})
export type DockerVolumeEntity = z.infer<typeof dockerVolumeEntitySchema>

export const dockerVolumeEntityListSchema = z.object({
  data: z.array(dockerVolumeEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerVolumeEntityList = z.infer<typeof dockerVolumeEntityListSchema>