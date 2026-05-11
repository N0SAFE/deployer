import z from 'zod/v4'
import { dockerListMetaSchema } from '../common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerServiceSnapshotSchema,
} from '../containers'
import { dockerImageSchema } from '../images'
import { dockerNetworkSchema } from '../networks'
import { dockerStackSchema } from '../stacks'
import { dockerRegistrySchema } from './base.schema'

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