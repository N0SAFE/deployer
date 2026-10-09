import type { DockerContainer, DockerImage } from '@repo/contracts-entities'
import type {
  ContainerAction,
  ContainerListQuery,
  ContainerRow,
  ContainerSortKey,
} from '../_models/container-list.model'

const RUNNING_STATES: ReadonlySet<string> = new Set(['running', 'restarting', 'paused'])

/** Running, restarting or paused: the container still holds a live process. */
export function isLive(row: Pick<ContainerRow, 'status'>): boolean {
  return RUNNING_STATES.has(row.status)
}

export function isUnhealthy(row: Pick<ContainerRow, 'status' | 'health'>): boolean {
  return row.status === 'dead' || row.status === 'exited' || row.health === 'unhealthy'
}

export function fallbackImageRef(imageId: string | null): string {
  if (!imageId) return 'unknown image'
  if (imageId.startsWith('sha256:')) return `sha256:${imageId.slice(7, 19)}`
  return imageId.slice(0, 18)
}

export function imageRef(image: Pick<DockerImage, 'registry' | 'repository' | 'tag'>): string {
  return `${image.registry}/${image.repository}${image.tag ? `:${image.tag}` : ''}`
}

export function formatPorts(ports: DockerContainer['ports']): string[] {
  return ports.map((port) => {
    const container = `${String(port.containerPort)}/${port.protocol}`
    return port.hostPort === null ? container : `${String(port.hostPort)}→${container}`
  })
}

export function toContainerRow(container: DockerContainer, imageRefById: ReadonlyMap<string, string>): ContainerRow {
  const image = container.imageId ? imageRefById.get(container.imageId) : undefined
  return {
    id: container.id,
    name: container.name,
    image: image ?? fallbackImageRef(container.imageId),
    imageId: container.imageId,
    status: container.status,
    health: container.health,
    environment: container.environment,
    serviceId: container.serviceId,
    managedBy: container.managedBy,
    ports: formatPorts(container.ports),
    updatedAt: container.updatedAt,
  }
}

type FilterQuery = Pick<ContainerListQuery, 'q' | 'view' | 'status' | 'environment' | 'ownership'>

export function filterContainerRows(rows: readonly ContainerRow[], query: FilterQuery): ContainerRow[] {
  const needle = query.q.trim().toLowerCase()
  return rows.filter((row) => {
    if (query.view === 'failed' && !isUnhealthy(row)) return false
    if (query.view === 'active' && row.status !== 'running') return false
    if (query.status !== 'all' && row.status !== query.status) return false
    if (query.environment !== 'all' && row.environment !== query.environment) return false
    if (query.ownership !== 'all' && row.managedBy !== query.ownership) return false
    if (!needle) return true
    return row.name.toLowerCase().includes(needle)
      || row.image.toLowerCase().includes(needle)
      || row.id.toLowerCase().includes(needle)
      || row.serviceId.toLowerCase().includes(needle)
      || row.status.toLowerCase().includes(needle)
  })
}

export function hasActiveFilters(query: FilterQuery): boolean {
  return query.q.trim() !== '' || query.view !== 'all' || query.status !== 'all'
    || query.environment !== 'all' || query.ownership !== 'all'
}

export const CONTAINER_SORTERS: Record<ContainerSortKey, (row: ContainerRow) => string | number> = {
  updated: (row) => new Date(row.updatedAt).getTime(),
  name: (row) => row.name.toLowerCase(),
  image: (row) => row.image.toLowerCase(),
  status: (row) => row.status,
  environment: (row) => row.environment ?? '',
}

/** Which of `rows` an action can actually apply to (Stop skips stopped containers, Start skips running ones). */
export function actionTargets(action: ContainerAction, rows: readonly ContainerRow[]): ContainerRow[] {
  switch (action) {
    case 'start': return rows.filter((row) => !isLive(row))
    case 'stop':
    case 'restart': return rows.filter(isLive)
    case 'remove': return [...rows]
  }
}

export interface ContainerSummary {
  total: number
  running: number
  stopped: number
  unhealthy: number
}

export function summarizeContainers(rows: readonly ContainerRow[]): ContainerSummary {
  let running = 0
  let stopped = 0
  let unhealthy = 0
  for (const row of rows) {
    if (row.status === 'running') running += 1
    else if (!isLive(row)) stopped += 1
    if (row.health === 'unhealthy') unhealthy += 1
  }
  return { total: rows.length, running, stopped, unhealthy }
}
