import { MOCK_SERVICES_BY_PROJECT } from './services.mock'
import { MOCK_DEPLOYMENTS } from './operations.mock'
import type {
  DockerContainer,
  DockerDeploymentSnapshot,
  DockerFleetServer,
  DockerImage,
  DockerImageSummary,
  DockerLogLine,
  DockerMeshEventStream,
  DockerMeshState,
  DockerNetwork,
  DockerNetworkSummary,
  DockerRegistry,
  DockerRegistrySummary,
  DockerServiceSnapshot,
  DockerStack,
  DockerStackSummary,
  DockerVolume,
  DockerVolumeSummary,
} from '../types'

interface QueryPagination {
  limit?: number
  offset?: number
}

export interface QueryInput {
  query?: QueryPagination
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function normalizeDate(value: string | undefined, fallbackMinutes: number): string {
  if (value) return value
  const fallback = new Date(Date.now() - fallbackMinutes * 60_000)
  return fallback.toISOString()
}

function volumeNameForService(service: DockerServiceSnapshot): string {
  const slug = service.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  const resolvedSlug = slug ? slug : `service-${shortId(service.id)}`
  return `${resolvedSlug}-data`
}

function parseImageReference(image: string): { registry: string; repository: string } {
  const [withoutDigestRaw] = image.split('@')
  const withoutDigest = withoutDigestRaw ?? ''
  const tagSeparator = withoutDigest.lastIndexOf(':')
  const slashSeparator = withoutDigest.lastIndexOf('/')
  const withoutTag = tagSeparator > slashSeparator ? withoutDigest.slice(0, tagSeparator) : withoutDigest
  const segments = withoutTag.split('/')

  const first = segments[0] ?? ''
  const hasRegistry = first.includes('.') || first.includes(':') || first === 'localhost'

  if (hasRegistry) {
    return {
      registry: first,
      repository: segments.slice(1).join('/') || 'unknown',
    }
  }

  return {
    registry: 'docker.io',
    repository: segments.join('/') || 'unknown',
  }
}

function safeEntityId(prefix: string, raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  return `${prefix}-${normalized || shortId(raw)}`
}

function mapDeploymentToContainerStatus(status: DockerDeploymentSnapshot['status']): DockerContainer['status'] {
  if (status === 'success') return 'running'
  if (status === 'failed') return 'exited'
  if (status === 'pending') return 'created'
  return 'restarting'
}

function normalizeDeploymentStatus(status: string): DockerDeploymentSnapshot['status'] {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'in-progress') return 'deploying'
  if (status === 'rolled-back') return 'cancelled'
  return 'pending'
}

function mapDeploymentToStackStatus(status: DockerStackSummary['latestDeploymentStatus']): DockerStack['status'] {
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'provisioning'
  if (status === 'success') return 'healthy'
  return 'unknown'
}

export const MOCK_DOCKER_SERVICES: DockerServiceSnapshot[] = Object.entries(MOCK_SERVICES_BY_PROJECT).flatMap(
  ([projectId, services], projectIndex) => {
    return services.map((service, serviceIndex) => {
      const updatedAt = new Date(Date.now() - (projectIndex * 20 + serviceIndex) * 60_000).toISOString()
      return {
        id: service.id,
        projectId,
        name: service.name,
        type: service.type,
        isActive: service.isActive,
        updatedAt,
        customDomains: [`${service.name}.${projectId.replace('proj-', '')}.mock.local`],
        resourceLimits: serviceIndex % 2 === 0 ? { storage: `${10 + (serviceIndex % 6) * 5}Gi` } : undefined,
        environmentVariables: serviceIndex % 3 === 0 ? { DATA_DIR: '/var/lib/data' } : undefined,
      }
    })
  },
)

export const MOCK_DOCKER_DEPLOYMENTS: DockerDeploymentSnapshot[] = MOCK_DEPLOYMENTS.map((deployment, index) => {
  const projectServices = MOCK_DOCKER_SERVICES.filter((service) => service.projectId === deployment.projectId)
  const linkedService = projectServices[index % Math.max(projectServices.length, 1)]

  const serviceId = linkedService?.id ?? `svc-mock-${index + 1}`
  const serviceName = linkedService?.name ?? `service-${index + 1}`
  const projectSlug = deployment.projectId.replace('proj-', '')
  const environment = deployment.environment
  const updatedAt = normalizeDate(deployment.finishedAt ?? deployment.startedAt, index * 10)

  return {
    id: deployment.id,
    projectId: deployment.projectId,
    serviceId,
    environment,
    status: normalizeDeploymentStatus(deployment.status),
    sourceType: 'git',
    containerName: `${serviceName}-${environment}`,
    containerImage: `ghcr.io/mock/${projectSlug}/${serviceName}:latest`,
    healthCheckUrl: `https://${serviceName}.${projectSlug}.mock.local/health`,
    domainUrl: `https://${serviceName}.${projectSlug}.mock.local`,
    createdAt: normalizeDate(deployment.startedAt, index * 10 + 2),
    updatedAt,
  }
})

export const MOCK_DOCKER_VOLUMES_ENTITIES: DockerVolume[] = (() => {
  const candidates = MOCK_DOCKER_SERVICES.filter(
    (service) => (service.resourceLimits?.storage ?? service.environmentVariables?.DATA_DIR) !== undefined,
  )

  const source = candidates.length > 0 ? candidates : MOCK_DOCKER_SERVICES.slice(0, 8)

  return source.map((service) => ({
    id: safeEntityId('vol', `${service.projectId}-${service.id}`),
    name: volumeNameForService(service),
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${volumeNameForService(service)}`,
    sizeBytes: null,
    usedByContainerIds: [],
    labels: {
      projectId: service.projectId,
      serviceId: service.id,
    },
    createdAt: service.updatedAt,
    updatedAt: service.updatedAt,
  }))
})()

export const MOCK_DOCKER_NETWORKS_ENTITIES: DockerNetwork[] = (() => {
  const grouped = new Map<string, DockerServiceSnapshot[]>()

  for (const service of MOCK_DOCKER_SERVICES) {
    const current = grouped.get(service.projectId) ?? []
    current.push(service)
    grouped.set(service.projectId, current)
  }

  return Array.from(grouped.entries()).map(([projectId, services]) => {
    const updatedAt = services
      .map((service) => service.updatedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    return {
      id: safeEntityId('net', projectId),
      name: `project-${shortId(projectId)}-net`,
      driver: 'bridge',
      scope: 'local',
      internal: false,
      attachable: true,
      subnet: null,
      gateway: null,
      containerIds: [],
      labels: { projectId },
      createdAt: updatedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
    }
  })
})()

export const MOCK_DOCKER_IMAGES_ENTITIES: DockerImage[] = (() => {
  const grouped = new Map<string, DockerImage>()

  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    const fullRef = deployment.containerImage ?? 'docker.io/library/unknown:latest'
    const parsed = parseImageReference(fullRef)
    const [withoutDigestRaw] = fullRef.split('@')
    const withoutDigest = withoutDigestRaw ?? fullRef
    const lastColon = withoutDigest.lastIndexOf(':')
    const lastSlash = withoutDigest.lastIndexOf('/')
    const tag = lastColon > lastSlash ? withoutDigest.slice(lastColon + 1) : null
    const digest = fullRef.includes('@') ? fullRef.split('@')[1] ?? null : null
    const id = safeEntityId('img', fullRef)
    const existing = grouped.get(id)

    if (!existing) {
      grouped.set(id, {
        id,
        registry: parsed.registry,
        repository: parsed.repository,
        tag,
        digest,
        sizeBytes: null,
        createdAt: deployment.createdAt,
        lastSeenAt: deployment.updatedAt,
        labels: {
          sourceType: deployment.sourceType,
        },
      })
      continue
    }

    if (new Date(deployment.updatedAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = deployment.updatedAt
    }
  }

  return Array.from(grouped.values())
})()

export const MOCK_DOCKER_CONTAINERS: DockerContainer[] = (() => {
  const networkIdByProjectId = new Map(
    MOCK_DOCKER_NETWORKS_ENTITIES.map((network) => [network.labels.projectId ?? '', network.id]),
  )

  const volumeIdsByServiceId = new Map<string, string[]>()
  for (const volume of MOCK_DOCKER_VOLUMES_ENTITIES) {
    const serviceId = volume.labels.serviceId
    if (!serviceId) continue
    const existing = volumeIdsByServiceId.get(serviceId) ?? []
    existing.push(volume.id)
    volumeIdsByServiceId.set(serviceId, existing)
  }

  const imageIdByRef = new Map(
    MOCK_DOCKER_IMAGES_ENTITIES.map((image) => {
      const imageRef = `${image.registry}/${image.repository}${image.tag ? `:${image.tag}` : ''}`
      return [imageRef, image.id]
    }),
  )

  return MOCK_DOCKER_DEPLOYMENTS.map((deployment, index) => {
    const networkId = networkIdByProjectId.get(deployment.projectId)
    const volumeIds = volumeIdsByServiceId.get(deployment.serviceId) ?? []
    const imageRef = deployment.containerImage ?? null
    const resolvedImageId = imageRef ? imageIdByRef.get(imageRef) ?? null : null
    const status = mapDeploymentToContainerStatus(deployment.status)

    return {
      id: safeEntityId('ctr', deployment.id),
      hash: safeEntityId('ctr-hash', `${deployment.projectId}-${deployment.serviceId}-${deployment.containerName ?? deployment.id}`),
      name: deployment.containerName ?? `container-${shortId(deployment.id)}`,
      projectId: deployment.projectId,
      serviceId: deployment.serviceId,
      stackId: safeEntityId('stack', deployment.projectId),
      imageId: resolvedImageId,
      status,
      health: status === 'running' ? 'healthy' : status === 'restarting' ? 'starting' : 'none',
      environment: deployment.environment,
      cpuPercent: status === 'running' ? 25 + (index % 30) : null,
      memoryPercent: status === 'running' ? 30 + (index % 35) : null,
      restartCount: status === 'restarting' ? 1 : 0,
      ports: [{ containerPort: 3000, hostPort: 4000 + index, protocol: 'tcp' }],
      networkIds: networkId ? [networkId] : [],
      volumeIds,
      managedBy: 'deployment_service',
      managedReason: 'mock_deployment_seed',
      managedDeploymentId: deployment.id,
      managedServiceId: deployment.serviceId,
      managedProjectId: deployment.projectId,
      managedImageRef: imageRef,
      managedNetworkMode: 'bridge',
      logsStreamId: deployment.id,
      startedAt: deployment.createdAt,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    }
  })
})()

for (const network of MOCK_DOCKER_NETWORKS_ENTITIES) {
  network.containerIds = MOCK_DOCKER_CONTAINERS.filter((container) => container.networkIds.includes(network.id)).map(
    (container) => container.id,
  )
}

for (const volume of MOCK_DOCKER_VOLUMES_ENTITIES) {
  volume.usedByContainerIds = MOCK_DOCKER_CONTAINERS.filter((container) => container.volumeIds.includes(volume.id)).map(
    (container) => container.id,
  )
}

export const MOCK_DOCKER_STACKS_ENTITIES: DockerStack[] = (() => {
  const deploymentsByServiceId = new Map<string, DockerDeploymentSnapshot>()
  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    const existing = deploymentsByServiceId.get(deployment.serviceId)
    if (!existing || new Date(deployment.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      deploymentsByServiceId.set(deployment.serviceId, deployment)
    }
  }

  const grouped = new Map<string, DockerServiceSnapshot[]>()
  for (const service of MOCK_DOCKER_SERVICES) {
    const current = grouped.get(service.projectId) ?? []
    current.push(service)
    grouped.set(service.projectId, current)
  }

  return Array.from(grouped.entries()).map(([projectId, services]) => {
    const stackId = safeEntityId('stack', projectId)
    const networkIds = MOCK_DOCKER_NETWORKS_ENTITIES.filter((network) => network.labels.projectId === projectId).map(
      (network) => network.id,
    )
    const volumeIds = MOCK_DOCKER_VOLUMES_ENTITIES.filter((volume) => volume.labels.projectId === projectId).map(
      (volume) => volume.id,
    )

    const serviceRefs = services.map((service) => {
      const latestDeployment = deploymentsByServiceId.get(service.id)
      const serviceContainers = MOCK_DOCKER_CONTAINERS.filter((container) => container.serviceId === service.id)

      return {
        serviceId: service.id,
        imageId: serviceContainers[0]?.imageId ?? null,
        containerIds: serviceContainers.map((container) => container.id),
        networkIds: serviceContainers.flatMap((container) => container.networkIds),
        volumeIds: serviceContainers.flatMap((container) => container.volumeIds),
        replicas: serviceContainers.length,
        desiredReplicas: serviceContainers.length,
        status: mapDeploymentToContainerStatus(latestDeployment?.status ?? 'pending'),
      }
    })

    const latestDeploymentStatus = services
      .map((service) => deploymentsByServiceId.get(service.id))
      .filter((deployment): deployment is DockerDeploymentSnapshot => deployment !== undefined)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.status

    const updatedAt = services
      .map((service) => service.updatedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    return {
      id: stackId,
      name: `stack-${shortId(projectId)}`,
      projectId,
      status: mapDeploymentToStackStatus(latestDeploymentStatus ?? null),
      services: serviceRefs,
      networkIds,
      volumeIds,
      labels: { projectId },
      createdAt: updatedAt ?? new Date().toISOString(),
      updatedAt: updatedAt ?? new Date().toISOString(),
    }
  })
})()

export const MOCK_DOCKER_REGISTRIES_ENTITIES: DockerRegistry[] = (() => {
  const grouped = new Map<string, DockerRegistry>()

  for (const image of MOCK_DOCKER_IMAGES_ENTITIES) {
    const existing = grouped.get(image.registry)
    const repositoryRef = image.repository

    if (!existing) {
      grouped.set(image.registry, {
        id: safeEntityId('reg', image.registry),
        name: image.registry,
        url: `https://${image.registry}`,
        authMode: 'token',
        status: 'healthy',
        isPrimary: image.registry === 'ghcr.io',
        repositories: [repositoryRef],
        lastSyncedAt: image.lastSeenAt,
        createdAt: image.createdAt,
        updatedAt: image.lastSeenAt,
      })
      continue
    }

    if (!existing.repositories.includes(repositoryRef)) {
      existing.repositories.push(repositoryRef)
    }
    if (new Date(image.lastSeenAt).getTime() > new Date(existing.updatedAt).getTime()) {
      existing.updatedAt = image.lastSeenAt
      existing.lastSyncedAt = image.lastSeenAt
    }
  }

  return Array.from(grouped.values())
})()

export const MOCK_DOCKER_FLEET_SERVERS: DockerFleetServer[] = [
  {
    nodeId: '22222222-2222-4222-8222-222222222222',
    serverUrl: 'https://fleet-node-a.mock.local',
    displayName: 'Fleet Node A',
    status: 'active',
    healthy: true,
    lastSeenAt: new Date(),
    maxCpuMillicores: 32000,
    maxMemoryMb: 65536,
    metrics: {
      cpuUsage: 0.38,
      memoryUsage: 0.44,
      activeStreams: 6,
      queueDepth: 12,
      reportedAt: new Date(),
    },
    allocationSummary: {
      organizations: 3,
      cpuMillicores: 12000,
      memoryMb: 28000,
    },
  },
  {
    nodeId: '33333333-3333-4333-8333-333333333333',
    serverUrl: 'https://fleet-node-b.mock.local',
    displayName: 'Fleet Node B',
    status: 'active',
    healthy: true,
    lastSeenAt: new Date(),
    maxCpuMillicores: 24000,
    maxMemoryMb: 49152,
    metrics: {
      cpuUsage: 0.52,
      memoryUsage: 0.61,
      activeStreams: 9,
      queueDepth: 18,
      reportedAt: new Date(),
    },
    allocationSummary: {
      organizations: 4,
      cpuMillicores: 16000,
      memoryMb: 31000,
    },
  },
  {
    nodeId: '44444444-4444-4444-8444-444444444444',
    serverUrl: 'https://fleet-node-c.mock.local',
    displayName: 'Fleet Node C',
    status: 'suspect',
    healthy: false,
    lastSeenAt: new Date(Date.now() - 5 * 60_000),
    maxCpuMillicores: 16000,
    maxMemoryMb: 32768,
    metrics: {
      cpuUsage: 0.83,
      memoryUsage: 0.78,
      activeStreams: 2,
      queueDepth: 41,
      reportedAt: new Date(Date.now() - 2 * 60_000),
    },
    allocationSummary: {
      organizations: 2,
      cpuMillicores: 14000,
      memoryMb: 25000,
    },
  },
]

export const MOCK_DOCKER_MESH_EVENT_STREAMS: DockerMeshEventStream[] = [
  {
    id: 'stream-mesh-runtime',
    name: 'mesh-runtime',
    scope: 'cluster',
    isActive: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'stream-deployments',
    name: 'deployment-events',
    scope: 'organization',
    isActive: true,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'stream-logs',
    name: 'container-logs',
    scope: 'service',
    isActive: false,
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
]

export const MOCK_DOCKER_MESH_STATE: DockerMeshState = {
  reason: 'membership_reconciled',
  peers: MOCK_DOCKER_FLEET_SERVERS.map((server) => ({ id: server.nodeId })),
  sessions: MOCK_DOCKER_MESH_EVENT_STREAMS.map((stream) => ({ id: stream.id })),
  revision: 42,
  emittedAt: new Date().toISOString(),
}

export const MOCK_DOCKER_LOG_LINES: DockerLogLine[] = [
  ...MOCK_DOCKER_DEPLOYMENTS.map((deployment) => {
    const containerName = deployment.containerName ?? `deployment-${shortId(deployment.id)}`
    const message =
      deployment.status === 'failed'
        ? `Deployment failed for ${containerName} on ${deployment.environment} (${deployment.sourceType})`
        : deployment.status === 'success'
          ? `Deployment completed for ${containerName} on ${deployment.environment} (${deployment.sourceType})`
          : `Deployment ${deployment.status} for ${containerName} on ${deployment.environment} (${deployment.sourceType})`

    return {
      id: deployment.id,
      containerName,
      source: 'deployment' as const,
      status: deployment.status,
      message,
      timestamp: deployment.updatedAt,
    }
  }),
  {
    id: `mesh-state-${String(MOCK_DOCKER_MESH_STATE.revision)}`,
    containerName: 'mesh-control-plane',
    source: 'mesh' as const,
    status: 'connected',
    message: `Mesh ${MOCK_DOCKER_MESH_STATE.reason.replaceAll('_', ' ')} · ${String(MOCK_DOCKER_MESH_STATE.sessions.length)} sessions · ${String(MOCK_DOCKER_MESH_STATE.peers.length)} peers`,
    timestamp: MOCK_DOCKER_MESH_STATE.emittedAt,
  },
].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

export const MOCK_DOCKER_IMAGES: DockerImageSummary[] = (() => {
  const grouped = new Map<string, DockerImageSummary>()

  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    const image = deployment.containerImage ?? 'unresolved-image'
    const existing = grouped.get(image)

    if (!existing) {
      grouped.set(image, {
        image,
        usageCount: 1,
        successful: deployment.status === 'success' ? 1 : 0,
        failed: deployment.status === 'failed' ? 1 : 0,
        lastSeenAt: deployment.updatedAt,
      })
      continue
    }

    existing.usageCount += 1
    existing.successful += deployment.status === 'success' ? 1 : 0
    existing.failed += deployment.status === 'failed' ? 1 : 0

    if (new Date(deployment.updatedAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = deployment.updatedAt
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.usageCount - a.usageCount)
})()

export const MOCK_DOCKER_STACKS: DockerStackSummary[] = (() => {
  const deploymentsByService = new Map<string, DockerDeploymentSnapshot>()

  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    const existing = deploymentsByService.get(deployment.serviceId)
    if (!existing || new Date(deployment.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      deploymentsByService.set(deployment.serviceId, deployment)
    }
  }

  const grouped = new Map<string, DockerStackSummary>()
  const deploymentCounts = new Map<string, number>()

  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    deploymentCounts.set(deployment.serviceId, (deploymentCounts.get(deployment.serviceId) ?? 0) + 1)
  }

  for (const service of MOCK_DOCKER_SERVICES) {
    const key = service.projectId
    const latestDeployment = deploymentsByService.get(service.id)
    const deploymentCount = deploymentCounts.get(service.id) ?? 0
    const existing = grouped.get(key)

    if (!existing) {
      grouped.set(key, {
        id: key,
        name: `stack-${shortId(key)}`,
        projectId: key,
        serviceCount: 1,
        activeServices: service.isActive ? 1 : 0,
        latestDeploymentStatus: latestDeployment?.status ?? null,
        deploymentCount,
      })
      continue
    }

    existing.serviceCount += 1
    existing.activeServices += service.isActive ? 1 : 0
    existing.deploymentCount += deploymentCount
    if (existing.latestDeploymentStatus !== 'failed' && latestDeployment?.status === 'failed') {
      existing.latestDeploymentStatus = 'failed'
    } else if (!existing.latestDeploymentStatus && latestDeployment?.status) {
      existing.latestDeploymentStatus = latestDeployment.status
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.serviceCount - a.serviceCount)
})()

export const MOCK_DOCKER_VOLUMES: DockerVolumeSummary[] = (() => {
  const projected = MOCK_DOCKER_SERVICES
    .filter((service) => (service.resourceLimits?.storage ?? service.environmentVariables?.DATA_DIR) !== undefined)
    .map((service) => ({
      id: service.id,
      name: volumeNameForService(service),
      serviceName: service.name,
      projectId: service.projectId,
      storageLimit: service.resourceLimits?.storage ?? 'unspecified',
      isActive: service.isActive,
      updatedAt: service.updatedAt,
    }))

  if (projected.length > 0) {
    return projected
  }

  return MOCK_DOCKER_SERVICES.slice(0, 8).map((service) => ({
    id: service.id,
    name: volumeNameForService(service),
    serviceName: service.name,
    projectId: service.projectId,
    storageLimit: service.resourceLimits?.storage ?? 'unspecified',
    isActive: service.isActive,
    updatedAt: service.updatedAt,
  }))
})()

export const MOCK_DOCKER_NETWORKS: DockerNetworkSummary[] = (() => {
  const grouped = new Map<string, DockerNetworkSummary>()

  for (const service of MOCK_DOCKER_SERVICES) {
    const key = service.projectId
    const existing = grouped.get(key)
    const domains = new Set(service.customDomains ?? [])

    if (!existing) {
      grouped.set(key, {
        id: key,
        name: `project-${shortId(key)}-net`,
        projectId: key,
        serviceCount: 1,
        activeServiceCount: service.isActive ? 1 : 0,
        exposedDomains: Array.from(domains),
      })
      continue
    }

    existing.serviceCount += 1
    existing.activeServiceCount += service.isActive ? 1 : 0
    for (const domain of domains) {
      if (!existing.exposedDomains.includes(domain)) {
        existing.exposedDomains.push(domain)
      }
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.serviceCount - a.serviceCount)
})()

export const MOCK_DOCKER_REGISTRIES: DockerRegistrySummary[] = (() => {
  const grouped = new Map<string, DockerRegistrySummary>()

  for (const deployment of MOCK_DOCKER_DEPLOYMENTS) {
    const image = deployment.containerImage ?? 'unresolved-image'
    const parsed = parseImageReference(image)
    const existing = grouped.get(parsed.registry)

    if (!existing) {
      grouped.set(parsed.registry, {
        registry: parsed.registry,
        repositoryCount: 1,
        imageCount: 1,
        lastSeenAt: deployment.updatedAt,
        repositories: [parsed.repository],
      })
      continue
    }

    existing.imageCount += 1
    if (!existing.repositories.includes(parsed.repository)) {
      existing.repositories.push(parsed.repository)
      existing.repositoryCount = existing.repositories.length
    }
    if (new Date(deployment.updatedAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = deployment.updatedAt
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.imageCount - a.imageCount)
})()