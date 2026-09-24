import z from 'zod/v4'
import { dockerListMetaSchema } from '@repo/contracts-entities/entities/docker/common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerServiceSnapshotSchema,
} from '@repo/contracts-entities/entities/docker/containers/index'
import { dockerImageSchema } from '@repo/contracts-entities/entities/docker/images/index'
import { dockerNetworkSchema } from '@repo/contracts-entities/entities/docker/networks/index'
import { dockerStackSchema } from '@repo/contracts-entities/entities/docker/stacks/index'
import { dockerRegistrySchema } from '@repo/contracts-entities/entities/docker/registries/base.schema'

export const dockerRegistryListSchema = z.object({
  data: z.array(z.lazy(() => dockerRegistrySchema)),
  meta: dockerListMetaSchema,
})
export type DockerRegistryList = z.infer<typeof dockerRegistryListSchema>

export const dockerRegistryRelationsSchema = z.object({
  images: z.array(z.lazy(() => dockerImageSchema)).optional(),
  stacks: z.array(z.lazy(() => dockerStackSchema)).optional(),
  services: z.array(z.lazy(() => dockerServiceSnapshotSchema)).optional(),
  projects: z.array(z.lazy(() => dockerContainerProjectRefSchema)).optional(),
  networks: z.array(z.lazy(() => dockerNetworkSchema)).optional(),
})
export type DockerRegistryRelations = z.infer<typeof dockerRegistryRelationsSchema>

export const dockerRegistryEntitySchema = dockerRegistrySchema.extend({
  relations: dockerRegistryRelationsSchema.optional(),
})
export type DockerRegistryEntity = z.infer<typeof dockerRegistryEntitySchema>

export const dockerRegistryEntityListSchema = z.object({
  data: z.array(dockerRegistryEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerRegistryEntityList = z.infer<typeof dockerRegistryEntityListSchema>