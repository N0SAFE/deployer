export {
  dockerRegistryAuthModeSchema,
  dockerRegistryStatusSchema,
  dockerRegistrySchema,
} from '@repo/contracts-entities/entities/docker/registries/base.schema'

export type {
  DockerRegistryAuthMode,
  DockerRegistryStatus,
  DockerRegistry,
} from '@repo/contracts-entities/entities/docker/registries/base.schema'

export {
  dockerRegistryListSchema,
  dockerRegistryRelationsSchema,
  dockerRegistryEntitySchema,
  dockerRegistryEntityListSchema,
} from '@repo/contracts-entities/entities/docker/registries/relations.schema'

export type {
  DockerRegistryList,
  DockerRegistryRelations,
  DockerRegistryEntity,
  DockerRegistryEntityList,
} from '@repo/contracts-entities/entities/docker/registries/relations.schema'

export {
  dockerRegistrySummarySchema,
  dockerRegistryTagDetailSchema,
  dockerRegistryRepositoryDetailSchema,
} from '@repo/contracts-entities/entities/docker/registries/details.schema'

export type {
  DockerRegistrySummary,
  DockerRegistryTagDetail,
  DockerRegistryRepositoryDetail,
} from '@repo/contracts-entities/entities/docker/registries/details.schema'