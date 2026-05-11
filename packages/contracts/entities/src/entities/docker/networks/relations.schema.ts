import z from 'zod/v4'
import { dockerListMetaSchema } from '../common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerContainerSchema,
  dockerServiceSnapshotSchema,
} from '../containers'
import { dockerImageSchema } from '../images'
import { dockerVolumeSchema } from '../volumes'
import { dockerStackSchema } from '../stacks'
import { dockerNetworkSchema } from './base.schema'

export const dockerNetworkListSchema = z.object({
  data: z.array(z.lazy(() => dockerNetworkSchema)),
  meta: dockerListMetaSchema,
})
export type DockerNetworkList = z.infer<typeof dockerNetworkListSchema>

export const dockerNetworkRelationsSchema = z.object({
  containers: z.array(z.lazy(() => dockerContainerSchema)).optional(),
  services: z.array(z.lazy(() => dockerServiceSnapshotSchema)).optional(),
  projects: z.array(z.lazy(() => dockerContainerProjectRefSchema)).optional(),
  stacks: z.array(z.lazy(() => dockerStackSchema)).optional(),
  volumes: z.array(z.lazy(() => dockerVolumeSchema)).optional(),
  images: z.array(z.lazy(() => dockerImageSchema)).optional(),
})
export type DockerNetworkRelations = z.infer<typeof dockerNetworkRelationsSchema>

export const dockerNetworkEntitySchema = dockerNetworkSchema.extend({
  relations: dockerNetworkRelationsSchema.optional(),
})
export type DockerNetworkEntity = z.infer<typeof dockerNetworkEntitySchema>

export const dockerNetworkEntityListSchema = z.object({
  data: z.array(dockerNetworkEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerNetworkEntityList = z.infer<typeof dockerNetworkEntityListSchema>