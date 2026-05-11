import z from 'zod/v4'
import { dockerListMetaSchema } from '../common.schema'
import {
  dockerContainerProjectRefSchema,
  dockerContainerSchema,
  dockerDeploymentSnapshotSchema,
  dockerServiceSnapshotSchema,
} from '../containers'
import { dockerImageSchema } from '../images'
import { dockerNetworkSchema } from '../networks'
import { dockerRegistrySchema } from '../registries'
import { dockerVolumeSchema } from '../volumes'
import { dockerStackSchema } from './base.schema'

export const dockerStackListSchema = z.object({
  data: z.array(z.lazy(() => dockerStackSchema)),
  meta: dockerListMetaSchema,
})
export type DockerStackList = z.infer<typeof dockerStackListSchema>

export const dockerStackRelationsSchema = z.object({
  project: z.lazy(() => dockerContainerProjectRefSchema).nullable().optional(),
  services: z.array(z.lazy(() => dockerServiceSnapshotSchema)).optional(),
  deployments: z.array(z.lazy(() => dockerDeploymentSnapshotSchema)).optional(),
  containers: z.array(z.lazy(() => dockerContainerSchema)).optional(),
  images: z.array(z.lazy(() => dockerImageSchema)).optional(),
  networks: z.array(z.lazy(() => dockerNetworkSchema)).optional(),
  volumes: z.array(z.lazy(() => dockerVolumeSchema)).optional(),
  registry: z.lazy(() => dockerRegistrySchema).nullable().optional(),
})
export type DockerStackRelations = z.infer<typeof dockerStackRelationsSchema>

export const dockerStackEntitySchema = dockerStackSchema.extend({
  relations: dockerStackRelationsSchema.optional(),
})
export type DockerStackEntity = z.infer<typeof dockerStackEntitySchema>

export const dockerStackEntityListSchema = z.object({
  data: z.array(dockerStackEntitySchema),
  meta: dockerListMetaSchema,
})
export type DockerStackEntityList = z.infer<typeof dockerStackEntityListSchema>