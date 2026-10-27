import { formatDateTime as formatDate } from '@/lib/format/date'
import type { useMeshSseState } from '@/domains/mesh/hooks'

export interface ServiceLogLine {
  id: string
  containerId: string | null
  containerName: string
  source: 'deployment' | 'mesh' | 'replica'
  status: string
  message: string
  timestamp: string
}

export interface DockerContainerLite {
  id: string
  name: string
  projectId: string
  serviceId: string
  status: string
  health: string
  updatedAt: string
  startedAt?: string | null
}

export interface DeploymentLite {
  id: string
  serviceId: string
  containerName?: string | null
  status: string
  environment: string
  updatedAt: string
}

type MeshSseResult = ReturnType<typeof useMeshSseState>

export interface ServiceActivityFilters {
  searchTerm: string
  source: 'all' | ServiceLogLine['source']
  replica: string
  selectedReplicaNames: ReadonlySet<string>
  clearedAt: number | null
}

/**
 * KNOWN GAP — these are not log lines.
 *
 * Every entry below is a sentence composed from a deployment status, a
 * container status, or the mesh state, so a page whose whole job is "show me
 * what this service printed" contains none of its actual output and cannot
 * answer "why did it fail". Real evidence is already fetchable —
 * `useDeploymentLogs` (domains/deployment/hooks) for build/deploy output and
 * `useDockerContainerLogsSnapshot` for a replica's stdout. Wiring those in is
 * the fix; this list is what the page showed before them.
 */
export function projectServiceActivity(params: {
  deployments: readonly DeploymentLite[]
  serviceContainers: readonly DockerContainerLite[]
  meshState: MeshSseResult['state']
  meshSseStatus: MeshSseResult['status']
  serviceId: string
}): ServiceLogLine[] {
  const { deployments, serviceContainers, meshState, meshSseStatus, serviceId } = params
  const projected: ServiceLogLine[] = []
  const serviceDeployments = deployments.filter((deployment) => deployment.serviceId === serviceId)

  for (const deployment of serviceDeployments.slice(0, 120)) {
    const containerName = deployment.containerName ?? `service-${deployment.id.slice(0, 8)}`
    const message =
      deployment.status === 'failed'
        ? `Deployment failed in ${deployment.environment}`
        : deployment.status === 'success'
          ? `Deployment completed in ${deployment.environment}`
          : `Deployment ${deployment.status} in ${deployment.environment}`

    projected.push({
      id: deployment.id,
      containerId: null,
      containerName,
      source: 'deployment',
      status: deployment.status,
      message,
      timestamp: deployment.updatedAt,
    })
  }

  for (const container of serviceContainers) {
    projected.push({
      id: `${container.id}-runtime`,
      containerId: container.id,
      containerName: container.name,
      source: 'replica',
      status: container.status,
      message: `${container.name} runtime ${container.status} · health ${container.health}`,
      timestamp: container.updatedAt,
    })

    if (container.startedAt) {
      projected.push({
        id: `${container.id}-started`,
        containerId: container.id,
        containerName: container.name,
        source: 'replica',
        status: 'started',
        message: `${container.name} started at ${formatDate(container.startedAt)}`,
        timestamp: container.startedAt,
      })
    }
  }

  if (meshState) {
    projected.push({
      id: `mesh-state-${String(meshState.revision)}-${serviceId}`,
      containerId: null,
      containerName: serviceId,
      source: 'mesh',
      status: meshSseStatus,
      message: `Mesh ${meshState.reason.replaceAll('_', ' ')} · ${String(meshState.sessions.length)} sessions · ${String(meshState.peers.length)} peers`,
      timestamp: meshState.emittedAt,
    })
  }

  return projected.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

export function filterServiceActivity(logs: readonly ServiceLogLine[], filters: ServiceActivityFilters): ServiceLogLine[] {
  const normalized = filters.searchTerm.trim().toLowerCase()

  return logs.filter((log) => {
    if (filters.source !== 'all' && log.source !== filters.source) return false
    if (filters.replica !== 'all' && log.containerName !== filters.replica) return false
    if (filters.selectedReplicaNames.size > 0 && !filters.selectedReplicaNames.has(log.containerName)) return false
    if (filters.clearedAt && new Date(log.timestamp).getTime() < filters.clearedAt) return false

    if (!normalized) return true

    return (
      log.containerName.toLowerCase().includes(normalized)
      || log.message.toLowerCase().includes(normalized)
      || log.status.toLowerCase().includes(normalized)
    )
  })
}

export function formatActivityLines(lines: readonly ServiceLogLine[]): string {
  return lines
    .map((log) => `${formatDate(log.timestamp)}\t${log.containerName}\t${log.source}\t${log.message}`)
    .join('\n')
}
