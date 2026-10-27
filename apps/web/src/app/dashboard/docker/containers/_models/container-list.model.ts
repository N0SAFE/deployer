import { z } from 'zod'
import type { DockerContainer } from '@deployer/contracts-entities'

/** URL state of the containers list. Everything the user can filter or sort lives here so a view is linkable. */
export const CONTAINER_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'active', 'failed']).default('all'),
  status: z.string().default('all'),
  environment: z.string().default('all'),
  ownership: z.enum(['all', 'deployment_service', 'orphan']).default('all'),
  sortBy: z.enum(['updated', 'name', 'image', 'status', 'environment']).default('updated'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

export type ContainerListQuery = z.infer<typeof CONTAINER_LIST_QUERY_SCHEMA>
export type ContainerSortKey = ContainerListQuery['sortBy']
export type ContainerView = ContainerListQuery['view']

export type ContainerAction = 'start' | 'stop' | 'restart' | 'remove'

/** One table row: the container entity flattened to what the page displays. */
export interface ContainerRow {
  id: string
  name: string
  image: string
  imageId: string | null
  status: DockerContainer['status']
  health: DockerContainer['health']
  environment: DockerContainer['environment']
  serviceId: string
  managedBy: DockerContainer['managedBy']
  /** Human port mappings, e.g. `8080→80/tcp`. Unpublished ports read `80/tcp`. */
  ports: string[]
  updatedAt: string
}
