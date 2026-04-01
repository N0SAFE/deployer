import type {
  DockerContainer,
  DockerContainerComposeConfig,
  DockerContainerEnvVarEntry,
  DockerContainerInspectDetail,
  DockerContainerLogEntry,
  DockerContainerMetricPoint,
  DockerContainerMountEntry,
  DockerContainerNetworkAttachment,
  DockerContainerPortMapping,
  DockerContainerProcessEntry,
  DockerFileEntry,
  DockerImage,
  DockerImageLayerEntry,
  DockerNetwork,
  DockerNetworkDiagnostics,
  DockerOperationProgressItem,
  DockerRegistry,
  DockerRegistryRepositoryDetail,
  DockerStack,
  DockerStackActivityEntry,
  DockerStackGitSyncState,
  DockerStackLogEntry,
  DockerStackServiceGraph,
  DockerTerminalProfile,
  DockerVulnerabilityEntry,
  DockerVolume,
} from '@repo/contracts-entities'
import {
  MOCK_DOCKER_CONTAINERS,
  MOCK_DOCKER_IMAGES_ENTITIES,
  MOCK_DOCKER_NETWORKS_ENTITIES,
  MOCK_DOCKER_REGISTRIES_ENTITIES,
  MOCK_DOCKER_STACKS_ENTITIES,
  MOCK_DOCKER_VOLUMES_ENTITIES,
} from './docker.mock'

const now = Date.now()

function iso(minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString()
}

function addSuffix(id: string, suffix: string): string {
  return `${id}-${suffix}`
}

function hashSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function scaleContainers(source: DockerContainer[], factor: number): DockerContainer[] {
  const all: DockerContainer[] = [...source]
  const environmentVariants = ['production', 'staging', 'preview'] as const
  for (let i = 1; i <= factor; i += 1) {
    for (const container of source) {
      const seed = hashSeed(`${container.id}:${String(i)}`)
      const variant = seed % 6
      const status: DockerContainer['status'] =
        variant === 0
          ? 'running'
          : variant === 1
            ? 'restarting'
            : variant === 2
              ? 'paused'
              : variant === 3
                ? 'exited'
                : variant === 4
                  ? 'created'
                  : 'dead'

      const health: DockerContainer['health'] =
        status === 'running'
          ? variant % 3 === 0
            ? 'unhealthy'
            : 'healthy'
          : status === 'restarting' || status === 'created'
            ? 'starting'
            : 'none'

      const cpuPercent =
        status === 'running' || status === 'restarting'
          ? Math.min(99, Math.max(4, (container.cpuPercent ?? 15) + (seed % 33) - 8))
          : null

      const memoryPercent =
        status === 'running' || status === 'restarting'
          ? Math.min(99, Math.max(6, (container.memoryPercent ?? 20) + (seed % 27) - 6))
          : null

      const inheritedEnvironment =
        container.environment
        ?? environmentVariants[seed % environmentVariants.length]
        ?? 'production'

      const environment =
        seed % 7 === 0
          ? null
          : environmentVariants[(seed + i) % environmentVariants.length] ?? inheritedEnvironment

      all.push({
        ...container,
        id: addSuffix(container.id, `r${String(i)}`),
        name: `${container.name}-${String(i + 1)}`,
        status,
        health,
        environment,
        cpuPercent,
        memoryPercent,
        restartCount: status === 'restarting' || status === 'dead' ? container.restartCount + 2 + (i % 3) : container.restartCount + (i % 2),
        ports: container.ports.map((port) => ({
          ...port,
          hostPort: typeof port.hostPort === 'number' ? port.hostPort + i * 100 : port.hostPort,
        })),
        createdAt: iso(600 + i * 20),
        startedAt: iso(560 + i * 20),
        updatedAt: iso(5 + i),
      })
    }
  }
  return all
}

function scaleImages(source: DockerImage[]): DockerImage[] {
  const tags = ['latest', 'stable', 'canary', 'debug'] as const
  const all: DockerImage[] = []
  for (const image of source) {
    for (let i = 0; i < tags.length; i += 1) {
      const tag = tags[i] ?? 'latest'
      all.push({
        ...image,
        id: addSuffix(image.id, tag),
        tag,
        digest: `sha256:${image.id.replace(/[^a-z0-9]/gi, '').slice(0, 24)}${String(i)}`,
        sizeBytes: (image.sizeBytes ?? 120_000_000) + i * 33_000_000,
        lastSeenAt: iso(i * 10 + 2),
      })
    }
  }
  return all
}

function scaleNetworks(source: DockerNetwork[]): DockerNetwork[] {
  const variants = ['frontend', 'backend', 'observability', 'batch'] as const
  const drivers: DockerNetwork['driver'][] = ['bridge', 'overlay', 'custom', 'bridge']
  const scopes: DockerNetwork['scope'][] = ['local', 'swarm', 'global', 'local']
  const all: DockerNetwork[] = [...source]
  for (const network of source) {
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i] ?? 'frontend'
      const driver = drivers[i] ?? 'bridge'
      const scope = scopes[i] ?? 'local'
      all.push({
        ...network,
        id: addSuffix(network.id, variant),
        name: `${network.name}-${variant}`,
        driver,
        scope,
        internal: variant === 'backend' || variant === 'batch',
        attachable: variant !== 'batch',
        subnet: `10.${String(30 + i)}.${String((i + 1) * 4)}.0/24`,
        gateway: `10.${String(30 + i)}.${String((i + 1) * 4)}.1`,
        labels: {
          ...network.labels,
          tier: variant,
        },
        updatedAt: iso(20 + i * 5),
      })
    }
  }
  return all
}

function scaleVolumes(source: DockerVolume[]): DockerVolume[] {
  const variants = ['data', 'cache', 'backup'] as const
  const drivers: DockerVolume['driver'][] = ['local', 'tmpfs', 'nfs']
  const all: DockerVolume[] = [...source]
  for (const volume of source) {
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i] ?? 'data'
      all.push({
        ...volume,
        id: addSuffix(volume.id, variant),
        name: `${volume.name}-${variant}`,
        driver: drivers[i] ?? 'local',
        mountpoint: `${volume.mountpoint ?? '/var/lib/docker/volumes/unknown'}/${variant}`,
        sizeBytes: variant === 'cache' ? null : (volume.sizeBytes ?? 12_000_000) + i * 5_000_000,
        labels: {
          ...volume.labels,
          usage: variant,
        },
        updatedAt: iso(50 + i * 4),
      })
    }
  }
  return all
}

function scaleStacks(source: DockerStack[]): DockerStack[] {
  const all: DockerStack[] = [...source]
  for (let i = 1; i <= 2; i += 1) {
    for (const stack of source) {
      const seed = hashSeed(`${stack.id}:${String(i)}`)
      const status: DockerStack['status'] =
        seed % 5 === 0
          ? 'failed'
          : seed % 5 === 1
            ? 'degraded'
            : seed % 5 === 2
              ? 'provisioning'
              : seed % 5 === 3
                ? 'paused'
                : 'healthy'

      all.push({
        ...stack,
        id: addSuffix(stack.id, `zone-${String(i)}`),
        name: `${stack.name}-zone-${String(i)}`,
        status,
        services: stack.services.map((service, index) => {
          const v = (seed + index) % 4
          const svcStatus: DockerStack['services'][number]['status'] =
            v === 0 ? 'running' : v === 1 ? 'restarting' : v === 2 ? 'exited' : 'paused'
          const desiredReplicas = Math.max(service.desiredReplicas, 1)
          const replicas = svcStatus === 'running' ? desiredReplicas : Math.max(0, desiredReplicas - 1)
          return {
            ...service,
            status: svcStatus,
            replicas,
            desiredReplicas,
          }
        }),
        labels: {
          ...stack.labels,
          zone: `eu-west-${String(i)}`,
        },
        updatedAt: iso(30 + i),
      })
    }
  }
  return all
}

function scaleRegistries(source: DockerRegistry[]): DockerRegistry[] {
  const extras: DockerRegistry[] = [
    {
      id: 'reg-dockerhub',
      name: 'docker.io',
      url: 'https://index.docker.io/v1/',
      authMode: 'token',
      status: 'healthy',
      isPrimary: false,
      repositories: ['library/nginx', 'library/postgres', 'library/redis', 'library/node'],
      lastSyncedAt: iso(3),
      createdAt: iso(800),
      updatedAt: iso(3),
    },
    {
      id: 'reg-harbor',
      name: 'harbor.internal',
      url: 'https://harbor.internal',
      authMode: 'basic',
      status: 'degraded',
      isPrimary: false,
      repositories: ['platform/api', 'platform/web', 'platform/worker', 'platform/proxy', 'security/scanner'],
      lastSyncedAt: iso(17),
      createdAt: iso(1200),
      updatedAt: iso(17),
    },
    {
      id: 'reg-airgap',
      name: 'airgap.registry.local',
      url: 'https://airgap.registry.local',
      authMode: 'oidc',
      status: 'offline',
      isPrimary: false,
      repositories: ['offline/snapshots', 'offline/base-images'],
      lastSyncedAt: iso(720),
      createdAt: iso(2100),
      updatedAt: iso(720),
    },
    {
      id: 'reg-edge-cache',
      name: 'edge-cache.local',
      url: 'https://edge-cache.local',
      authMode: 'anonymous',
      status: 'unknown',
      isPrimary: false,
      repositories: ['cache/node', 'cache/nginx'],
      lastSyncedAt: null,
      createdAt: iso(340),
      updatedAt: iso(95),
    },
  ]

  return [...source, ...extras]
}

export const MOCK_DOCKER_CONTAINERS_REALISTIC: DockerContainer[] = scaleContainers(MOCK_DOCKER_CONTAINERS, 4)
export const MOCK_DOCKER_IMAGES_REALISTIC: DockerImage[] = scaleImages(MOCK_DOCKER_IMAGES_ENTITIES)
export const MOCK_DOCKER_NETWORKS_REALISTIC: DockerNetwork[] = scaleNetworks(MOCK_DOCKER_NETWORKS_ENTITIES)
export const MOCK_DOCKER_VOLUMES_REALISTIC: DockerVolume[] = scaleVolumes(MOCK_DOCKER_VOLUMES_ENTITIES)
export const MOCK_DOCKER_STACKS_REALISTIC: DockerStack[] = scaleStacks(MOCK_DOCKER_STACKS_ENTITIES)
export const MOCK_DOCKER_REGISTRIES_REALISTIC: DockerRegistry[] = scaleRegistries(MOCK_DOCKER_REGISTRIES_ENTITIES)

const containerFileCache = new Map<string, DockerFileEntry[]>()

function buildFileTree(containerId: string): DockerFileEntry[] {
  const result: DockerFileEntry[] = []
  const baseDirs = ['/app', '/app/src', '/app/dist', '/app/logs', '/data', '/tmp', '/etc', '/var/run']
  for (let i = 0; i < baseDirs.length; i += 1) {
    result.push({
      path: baseDirs[i] ?? '/app',
      type: 'dir',
      size: '—',
      permissions: 'drwxr-xr-x',
      owner: 'root:root',
      updatedAt: iso(i + 2),
    })
  }

  const files = [
    '/app/.env',
    '/app/package.json',
    '/app/src/server.ts',
    '/app/src/config/runtime.ts',
    '/app/dist/server.js',
    '/app/logs/runtime.log',
    '/app/logs/error.log',
    '/etc/hosts',
    '/etc/hostname',
    '/data/health.json',
  ]

  for (let i = 0; i < files.length; i += 1) {
    result.push({
      path: files[i] ?? '/app/.env',
      type: 'file',
      size: `${String(2 + i)}.${String((i * 3) % 10)} KB`,
      permissions: '-rw-r--r--',
      owner: i % 2 === 0 ? 'node:node' : 'root:root',
      updatedAt: iso(i + 1),
    })
  }

  for (let i = 1; i <= 40; i += 1) {
    result.push({
      path: `/app/logs/archive/${containerId.slice(0, 8)}-${String(i)}.log`,
      type: 'file',
      size: `${String(24 + i)} KB`,
      permissions: '-rw-r-----',
      owner: 'node:node',
      updatedAt: iso(i + 30),
    })
  }

  return result
}

export function getMockContainerFiles(containerId: string): DockerFileEntry[] {
  const cached = containerFileCache.get(containerId)
  if (cached) return cached
  const generated = buildFileTree(containerId)
  containerFileCache.set(containerId, generated)
  return generated
}

export function getMockImageLayers(imageId: string): DockerImageLayerEntry[] {
  const seed = imageId.slice(0, 8)
  return [
    { id: `${seed}-l1`, instruction: 'FROM node:20-alpine', size: '58 MB', createdAt: iso(320) },
    { id: `${seed}-l2`, instruction: 'RUN apk add --no-cache libc6-compat', size: '6 MB', createdAt: iso(318) },
    { id: `${seed}-l3`, instruction: 'COPY package.json bun.lock ./', size: '1.2 MB', createdAt: iso(315) },
    { id: `${seed}-l4`, instruction: 'RUN bun install --frozen-lockfile', size: '128 MB', createdAt: iso(312) },
    { id: `${seed}-l5`, instruction: 'COPY . .', size: '44 MB', createdAt: iso(309) },
    { id: `${seed}-l6`, instruction: 'RUN bun run build', size: '92 MB', createdAt: iso(305) },
  ]
}

export function getMockImageVulnerabilities(imageId: string): DockerVulnerabilityEntry[] {
  const seed = imageId.replace(/[^a-z0-9]/gi, '').slice(0, 6)
  return [
    {
      id: `CVE-2026-${seed}0`,
      severity: 'critical',
      packageName: 'glibc',
      currentVersion: '2.38-r0',
      fixedVersion: null,
      description: 'Potential remote code execution path in locale parsing for crafted payloads.',
    },
    {
      id: `CVE-2025-${seed}1`,
      severity: 'high',
      packageName: 'openssl',
      currentVersion: '3.0.11-r0',
      fixedVersion: '3.0.13-r0',
      description: 'Potential out-of-bounds read in certificate parsing path.',
    },
    {
      id: `CVE-2024-${seed}2`,
      severity: 'medium',
      packageName: 'zlib',
      currentVersion: '1.2.13-r1',
      fixedVersion: '1.2.13-r2',
      description: 'Compression stream edge case under malformed payloads.',
    },
    {
      id: `CVE-2023-${seed}3`,
      severity: 'low',
      packageName: 'busybox',
      currentVersion: '1.36.0-r2',
      fixedVersion: null,
      description: 'Low-risk information exposure in uncommon shell utility usage.',
    },
  ]
}

export interface DockerImagePullLayerStreamEntry {
  id: string
  digest: string
  instruction: string
  size: string
  order: number
  events: Array<{
    at: string
    status: 'queued' | 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'completed'
    progress: number
    message: string
  }>
}

export interface DockerImagePullLogEntry {
  id: string
  at: string
  level: 'info' | 'warn' | 'success'
  component: 'registry' | 'engine' | 'snapshotter' | 'content-store'
  message: string
}

export interface DockerImageScanFindingEntry extends DockerVulnerabilityEntry {
  source: 'trivy' | 'grype'
  packageType: 'os' | 'node' | 'python' | 'go'
  cwe: string[]
}

export interface DockerImageScanSourceStream {
  source: 'trivy' | 'grype'
  status: 'queued' | 'running' | 'completed'
  startedAt: string
  completedAt: string
  logs: Array<{
    id: string
    at: string
    level: 'info' | 'warn' | 'success'
    message: string
  }>
  findings: DockerImageScanFindingEntry[]
}

export interface DockerImagePullScanPipelineMock {
  imageRef: string
  generatedAt: string
  layers: DockerImagePullLayerStreamEntry[]
  pullLogs: DockerImagePullLogEntry[]
  scan: {
    sources: DockerImageScanSourceStream[]
    mergedFindings: DockerImageScanFindingEntry[]
    mergedSummary: {
      critical: number
      high: number
      medium: number
      low: number
    }
  }
}

function normalizeImageSeed(imageRef: string): string {
  return imageRef.trim() || 'ghcr.io/mock/platform:latest'
}

function severityRank(value: DockerVulnerabilityEntry['severity']): number {
  if (value === 'critical') return 4
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function summarizeFindings(findings: DockerImageScanFindingEntry[]): { critical: number; high: number; medium: number; low: number } {
  return findings.reduce(
    (acc, finding) => {
      acc[finding.severity] += 1
      return acc
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  )
}

export function getMockImagePullScanPipeline(imageRef: string): DockerImagePullScanPipelineMock {
  const normalized = normalizeImageSeed(imageRef)
  const seed = hashSeed(normalized)
  const seedHex = seed.toString(16).padStart(8, '0')
  const baseFindings = getMockImageVulnerabilities(seedHex)
  const layers = getMockImageLayers(seedHex)

  const layerStream: DockerImagePullLayerStreamEntry[] = layers.map((layer, index) => {
    const layerSeed = hashSeed(`${normalized}:layer:${layer.id}`)
    const pullOffset = 40 - index * 2
    return {
      id: layer.id,
      digest: `sha256:${layerSeed.toString(16).padStart(8, '0')}${seedHex}${String(index)}`,
      instruction: layer.instruction,
      size: layer.size,
      order: index,
      events: [
        { at: iso(pullOffset + 8), status: 'queued', progress: 0, message: 'Layer queued in pull manager' },
        { at: iso(pullOffset + 7), status: 'resolving', progress: 8, message: 'Resolving layer digest and descriptor' },
        { at: iso(pullOffset + 6), status: 'downloading', progress: 42, message: 'Downloading compressed layer blob' },
        { at: iso(pullOffset + 5), status: 'verifying', progress: 63, message: 'Verifying SHA256 checksum' },
        { at: iso(pullOffset + 4), status: 'extracting', progress: 86, message: 'Extracting filesystem diff to snapshot' },
        { at: iso(pullOffset + 3), status: 'completed', progress: 100, message: 'Layer fully applied to local image store' },
      ],
    }
  })

  const trivyFindings: DockerImageScanFindingEntry[] = baseFindings
    .filter((_, index) => index % 2 === 0)
    .map((entry, index) => ({
      ...entry,
      id: `${entry.id}-trivy`,
      source: 'trivy',
      packageType: index % 3 === 0 ? 'os' : 'node',
      cwe: entry.severity === 'critical' ? ['CWE-787', 'CWE-416'] : ['CWE-200'],
      description: `[Trivy] ${entry.description}`,
    }))

  const grypeFindings: DockerImageScanFindingEntry[] = baseFindings
    .filter((_, index) => index % 2 === 1 || index === 0)
    .map((entry, index) => ({
      ...entry,
      id: `${entry.id}-grype`,
      source: 'grype',
      packageType: index % 2 === 0 ? 'os' : 'go',
      cwe: entry.severity === 'high' ? ['CWE-125', 'CWE-120'] : ['CWE-79'],
      description: `[Grype] ${entry.description}`,
    }))

  const mergedById = new Map<string, DockerImageScanFindingEntry>()
  for (const finding of [...trivyFindings, ...grypeFindings]) {
    const key = `${finding.packageName}:${finding.currentVersion}:${finding.severity}`
    const existing = mergedById.get(key)
    if (!existing || severityRank(finding.severity) >= severityRank(existing.severity)) {
      mergedById.set(key, finding)
    }
  }

  const mergedFindings = Array.from(mergedById.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity))

  const scanSources: DockerImageScanSourceStream[] = [
    {
      source: 'trivy',
      status: 'completed',
      startedAt: iso(18),
      completedAt: iso(14),
      logs: [
        { id: 'trivy-1', at: iso(18), level: 'info', message: `2026-03-26T10:12:04Z\tINFO\tNeed to update DB` },
        { id: 'trivy-2', at: iso(17), level: 'info', message: `2026-03-26T10:12:08Z\tINFO\tDownloading DB artifact...\trepository="ghcr.io/aquasecurity/trivy-db:2"` },
        { id: 'trivy-3', at: iso(16), level: 'info', message: `2026-03-26T10:12:14Z\tINFO\tDetected OS\tfamily="alpine" version="3.20"` },
        { id: 'trivy-4', at: iso(15), level: 'warn', message: `2026-03-26T10:12:19Z\tWARN\tVulnerability found\tpkg="openssl" installed="3.0.8-r1" fixed="3.0.12-r0" vuln="CVE-2025-24021" severity="CRITICAL"` },
        { id: 'trivy-5', at: iso(14), level: 'success', message: `2026-03-26T10:12:24Z\tINFO\tScan summary\ttotal=${String(trivyFindings.length)} scanner=trivy` },
      ],
      findings: trivyFindings,
    },
    {
      source: 'grype',
      status: 'completed',
      startedAt: iso(18),
      completedAt: iso(13),
      logs: [
        { id: 'grype-1', at: iso(18), level: 'info', message: `[0000]  INFO grype version: 0.79.0` },
        { id: 'grype-2', at: iso(16), level: 'info', message: `[0001]  INFO loading providers\tsource=registry image="${normalized}"` },
        { id: 'grype-3', at: iso(15), level: 'info', message: `[0002]  INFO cataloging image packages with syft` },
        { id: 'grype-4', at: iso(14), level: 'warn', message: `[0003]  WARN vulnerability match\tpkg=glibc version=2.37-r2 vuln=CVE-2025-11904 severity=High` },
        { id: 'grype-5', at: iso(13), level: 'success', message: `[0004]  INFO found ${String(grypeFindings.length)} vulnerabilities` },
      ],
      findings: grypeFindings,
    },
  ]

  const pullLogs: DockerImagePullLogEntry[] = [
    { id: 'pull-1', at: iso(42), level: 'info', component: 'registry', message: `time="2026-03-26T10:11:41Z" level=info msg="pulling from ${(normalized.split(':')[0] ?? normalized)}"` },
    { id: 'pull-2', at: iso(40), level: 'info', component: 'content-store', message: `a1f2d3c4e5f6: Pulling fs layer` },
    { id: 'pull-3', at: iso(37), level: 'info', component: 'engine', message: `a1f2d3c4e5f6: Download complete\n9e8d7c6b5a4f: Downloading [=======>                                   ]  23.6MB/121.2MB` },
    { id: 'pull-4', at: iso(34), level: 'warn', component: 'registry', message: `9e8d7c6b5a4f: Retrying in 1 second due to rate limit (HTTP 429)` },
    { id: 'pull-5', at: iso(31), level: 'info', component: 'snapshotter', message: `Digest: sha256:${seedHex}${seedHex}\nStatus: Downloaded newer image for ${normalized}` },
    { id: 'pull-6', at: iso(28), level: 'success', component: 'engine', message: normalized },
  ]

  return {
    imageRef: normalized,
    generatedAt: iso(0),
    layers: layerStream,
    pullLogs,
    scan: {
      sources: scanSources,
      mergedFindings,
      mergedSummary: summarizeFindings(mergedFindings),
    },
  }
}

export function getMockRegistryRepositories(registry: DockerRegistry): DockerRegistryRepositoryDetail[] {
  const topRepos = registry.repositories.slice(0, 12)
  return topRepos.map((repository, index) => ({
    repository,
    tags: ['latest', 'stable', 'canary', 'rollback']
      .slice(0, index % 4 === 3 ? 1 : 4)
      .map((tag, tagIndex) => ({
      name: tag,
      digest: `sha256:${registry.id.replace(/[^a-z0-9]/gi, '').slice(0, 10)}${String(index)}${String(tagIndex)}`,
      size: `${String(120 + index * 8 + tagIndex * 3)} MB`,
      pushedAt: iso(index * 15 + tagIndex * 4 + 1),
      })),
  }))
}

export function getMockStackComposeYaml(stack: DockerStack): string {
  const serviceLines = stack.services
    .slice(0, 8)
    .map((service, index) => {
      const name = `service_${String(index + 1)}_${service.serviceId.slice(0, 6)}`
      return `  ${name}:\n    image: ghcr.io/mock/${stack.projectId}/${service.serviceId}:latest\n    restart: unless-stopped\n    deploy:\n      replicas: ${String(Math.max(service.desiredReplicas, 1))}\n    labels:\n      - project=${stack.projectId}\n      - stack=${stack.name}`
    })
    .join('\n')

  return `version: "3.9"\nname: ${stack.name}\nservices:\n${serviceLines || '  app:\n    image: ghcr.io/mock/app:latest'}\nnetworks:\n  default:\n    external: false\nvolumes:\n  data:\n    driver: local\n`
}

export function getMockStackActivity(stackId: string): DockerStackActivityEntry[] {
  const seed = hashSeed(stackId)
  const hasFailure = seed % 3 === 0
  return [
    { id: `${stackId}-a1`, event: 'compose validated', status: 'success', timestamp: iso(44) },
    { id: `${stackId}-a2`, event: 'images pulled', status: 'success', timestamp: iso(41) },
    { id: `${stackId}-a3`, event: 'services recreated', status: hasFailure ? 'failed' : 'success', timestamp: iso(36) },
    { id: `${stackId}-a4`, event: 'health checks', status: hasFailure ? 'pending' : 'success', timestamp: iso(33) },
    { id: `${stackId}-a5`, event: hasFailure ? 'rollback triggered' : 'deploy completed', status: hasFailure ? 'failed' : 'success', timestamp: iso(31) },
  ]
}

export function getMockNetworkDiagnostics(network: DockerNetwork): DockerNetworkDiagnostics {
  const degraded = network.driver !== 'bridge' || network.internal || network.containerIds.length === 0
  const score = degraded
    ? Math.max(42, Math.min(78, 64 + network.containerIds.length))
    : Math.max(74, Math.min(99, 86 + network.containerIds.length * 2))

  return {
    dnsResolution: degraded ? 'degraded' : 'ok',
    connectivityScore: score,
    notes: [
      `Driver: ${network.driver}`,
      `Scope: ${network.scope}`,
      network.internal ? 'Internal network isolation enabled.' : 'Ingress/egress allowed by default policy.',
      `Attached containers: ${String(network.containerIds.length)}`,
      degraded ? 'Observed intermittent DNS lookup failures in diagnostics probe.' : 'Routing and DNS probes are stable.',
    ],
  }
}

export function getMockVolumeFiles(volumeId: string): DockerFileEntry[] {
  const prefix = volumeId.slice(0, 8)
  return [
    { path: '/data', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root:root', updatedAt: iso(28) },
    { path: '/data/backups', type: 'dir', size: '—', permissions: 'drwxr-x---', owner: 'node:node', updatedAt: iso(22) },
    { path: '/data/config.json', type: 'file', size: '12 KB', permissions: '-rw-r--r--', owner: 'node:node', updatedAt: iso(19) },
    { path: '/data/state.db', type: 'file', size: '92 MB', permissions: '-rw-------', owner: 'node:node', updatedAt: iso(17) },
    { path: `/data/backups/${prefix}-snapshot-1.tar.gz`, type: 'file', size: '210 MB', permissions: '-rw-r-----', owner: 'root:root', updatedAt: iso(13) },
    { path: `/data/backups/${prefix}-snapshot-2.tar.gz`, type: 'file', size: '222 MB', permissions: '-rw-r-----', owner: 'root:root', updatedAt: iso(9) },
  ]
}

export function getMockContainerLogs(containerId: string): DockerContainerLogEntry[] {
  const seed = containerId.slice(0, 8)
  const unstable = hashSeed(containerId) % 4 === 0
  return [
    { id: `${seed}-log-1`, timestamp: iso(8), stream: 'stdout', level: 'info', message: 'HTTP server listening on 0.0.0.0:3000' },
    { id: `${seed}-log-2`, timestamp: iso(7), stream: 'stdout', level: 'info', message: 'Connected to postgres:5432 successfully' },
    { id: `${seed}-log-3`, timestamp: iso(6), stream: 'stdout', level: unstable ? 'error' : 'warn', message: unstable ? 'OOM killer evicted worker process' : 'Cache miss ratio above baseline (45%)' },
    { id: `${seed}-log-4`, timestamp: iso(4), stream: 'stderr', level: 'error', message: unstable ? 'Crash loop detected: restart backoff 30s' : 'Upstream timeout while querying billing provider' },
    { id: `${seed}-log-5`, timestamp: iso(3), stream: 'stdout', level: 'info', message: 'Health probe /health responded 200 in 12ms' },
    { id: `${seed}-log-6`, timestamp: iso(1), stream: 'stdout', level: 'info', message: 'Background worker processed 32 jobs' },
  ]
}

export function getMockContainerMetrics(containerId: string): DockerContainerMetricPoint[] {
  const base = containerId.charCodeAt(0) % 10
  const unstable = hashSeed(containerId) % 5 === 0
  const points: DockerContainerMetricPoint[] = []
  for (let i = 0; i < 20; i += 1) {
    const spike = unstable && i > 14 ? (i - 14) * 6 : 0
    points.push({
      at: iso(20 - i),
      cpu: Math.min(98, 18 + base + i * 1.6 + spike),
      memory: Math.min(96, 24 + base + i * 1.2 + spike * 0.8),
      networkRxKb: 120 + i * 8,
      networkTxKb: 90 + i * 7,
      ioReadKb: 60 + i * 4,
      ioWriteKb: 52 + i * 5,
    })
  }
  return points
}

export function getMockContainerTerminalProfiles(containerId: string): DockerTerminalProfile[] {
  const preferred = containerId.charCodeAt(0) % 2 === 0 ? 'bash' : 'sh'
  return [
    { shell: 'bash', user: 'root', workingDir: '/app', recommended: preferred === 'bash' },
    { shell: 'sh', user: 'node', workingDir: '/app', recommended: preferred === 'sh' },
    { shell: 'zsh', user: 'root', workingDir: '/root', recommended: false },
    { shell: 'ash', user: 'node', workingDir: '/app', recommended: false },
  ]
}

export function getMockContainerProcesses(containerId: string): DockerContainerProcessEntry[] {
  const seed = hashSeed(containerId)
  const nowIso = iso(0)
  const processNames = [
    'node server.js',
    'node worker.js --queue default',
    'nginx: master process',
    'nginx: worker process',
    'postgres: checkpointer',
    'redis-server *:6379',
    'bun run dev --watch',
    'tail -f /var/log/app.log',
  ]

  return processNames.map((command, index) => {
    const variation = (seed + index * 17) % 100
    const state: DockerContainerProcessEntry['state'] =
      index === 0
        ? 'running'
        : variation % 7 === 0
          ? 'sleeping'
          : variation % 11 === 0
            ? 'zombie'
            : variation % 5 === 0
              ? 'stopped'
              : 'idle'

    return {
      pid: 100 + index * 13 + (seed % 31),
      user: index % 3 === 0 ? 'root' : 'node',
      cpuPercent: Number(Math.min(96, Math.max(0.3, 3 + variation * 0.35)).toFixed(1)),
      memoryPercent: Number(Math.min(92, Math.max(0.6, 2 + variation * 0.28)).toFixed(1)),
      state,
      startedAt: index === 0 ? nowIso : iso(8 + index * 3),
      command,
    }
  })
}

function toContainerNetworkAttachment(container: DockerContainer): DockerContainerNetworkAttachment[] {
  return container.networkIds.map((networkId, index) => {
    const network = MOCK_DOCKER_NETWORKS_REALISTIC.find((n) => n.id === networkId)
    return {
      networkId,
      name: network?.name ?? `network-${networkId.slice(0, 8)}`,
      driver: network?.driver ?? 'bridge',
      scope: network?.scope ?? 'local',
      ipv4: network?.subnet ? `${network.subnet.split('/')[0]?.replace(/\.0$/, '')}.${String(10 + index)}` : null,
      ipv6: null,
      gateway: network?.gateway ?? null,
      macAddress: `02:42:ac:11:${String(10 + index).padStart(2, '0')}:${String((20 + index) % 99).padStart(2, '0')}`,
      aliases: [container.name, container.serviceId],
      dnsServers: network?.driver === 'bridge' ? ['1.1.1.1', '8.8.8.8'] : ['9.9.9.9'],
      dnsSearch: ['svc.local', 'docker.internal'],
      dnsOptions: ['ndots:5', 'timeout:2'],
      extraHosts: ['host.docker.internal:host-gateway'],
    }
  })
}

function toContainerPortMappings(container: DockerContainer): DockerContainerPortMapping[] {
  return container.ports.map((port) => ({
    containerPort: port.containerPort,
    hostIp: '0.0.0.0',
    hostPort: port.hostPort ?? null,
    protocol: port.protocol,
    url: typeof port.hostPort === 'number' && port.protocol === 'tcp' ? `http://127.0.0.1:${String(port.hostPort)}` : null,
  }))
}

function toContainerMounts(container: DockerContainer): DockerContainerMountEntry[] {
  const volumeMounts: DockerContainerMountEntry[] = container.volumeIds.map((volumeId, index) => {
    const volume = MOCK_DOCKER_VOLUMES_REALISTIC.find((v) => v.id === volumeId)
    return {
      type: volume?.driver === 'tmpfs' ? 'tmpfs' : 'volume',
      mountName: volume?.name ?? null,
      source: volume?.mountpoint ?? `/var/lib/docker/volumes/${volumeId}`,
      target: index % 2 === 0 ? '/app/data' : '/app/cache',
      readOnly: index % 3 === 0,
      propagation: 'rprivate',
      mode: index % 3 === 0 ? 'ro' : 'rw',
      sizeBytes: volume?.sizeBytes ?? null,
    }
  })

  return [
    {
      type: 'bind',
      mountName: null,
      source: `/srv/projects/${container.projectId}/src`,
      target: '/app/src',
      readOnly: false,
      propagation: 'rprivate',
      mode: 'rw',
      sizeBytes: null,
    },
    ...volumeMounts,
  ]
}

function toContainerEnvVars(container: DockerContainer): DockerContainerEnvVarEntry[] {
  const env = container.environment ?? 'development'
  return [
    { key: 'NODE_ENV', value: env, masked: false, source: 'runtime' },
    { key: 'SERVICE_ID', value: container.serviceId, masked: false, source: 'compose' },
    { key: 'PROJECT_ID', value: container.projectId, masked: false, source: 'compose' },
    { key: 'PORT', value: '3000', masked: false, source: 'image' },
    { key: 'WATCH_MODE', value: env === 'production' ? 'false' : 'true', masked: false, source: 'runtime' },
    { key: 'DATABASE_URL', value: 'postgres://***:***@db.internal:5432/app', masked: true, source: 'secret' },
    { key: 'REDIS_URL', value: 'redis://cache.internal:6379/0', masked: false, source: 'runtime' },
  ]
}

function toContainerComposeConfig(container: DockerContainer): DockerContainerComposeConfig {
  const orchestrators = ['compose', 'swarm', 'kubernetes'] as const
  const orchestrator = orchestrators[hashSeed(container.id) % orchestrators.length] ?? 'compose'
  const memLimitMb = container.environment === 'production' ? 1024 : 512
  const memReservationMb = container.environment === 'production' ? 768 : 256
  const restart = container.environment === 'production' ? 'unless-stopped' : 'on-failure'
  const dependsOn: DockerContainerComposeConfig['dependsOn'] = [
    { service: 'postgres', condition: 'service_healthy', required: true },
    { service: 'redis', condition: 'service_started', required: true },
    { service: 'migrations', condition: 'service_completed_successfully', required: false },
  ]

  const ports = toContainerPortMappings(container)
    .filter((p) => p.hostPort !== null)
    .map((p) => `${String(p.hostPort)}:${String(p.containerPort)}/${p.protocol}`)

  const volumes = toContainerMounts(container).map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ':rw'}`)

  const rawYaml = [
    'services:',
    `  ${container.serviceId}:`,
    `    image: ${container.imageId ?? 'ghcr.io/mock/app:latest'}`,
    `    restart: ${restart}`,
    '    deploy:',
    `      resources:`,
    `        limits:`,
    `          memory: ${String(memLimitMb)}M`,
    `        reservations:`,
    `          memory: ${String(memReservationMb)}M`,
    '    depends_on:',
    ...dependsOn.map((dep) => `      ${dep.service}: { condition: ${dep.condition} }`),
    '    ports:',
    ...ports.map((p) => `      - "${p}"`),
    '    volumes:',
    ...volumes.map((v) => `      - ${v}`),
  ].join('\n')

  return {
    serviceName: container.serviceId,
    projectName: container.projectId,
    composeFilePath: `/srv/orchestrator/${container.projectId}/docker-compose.yml`,
    dependsOn,
    dns: ['1.1.1.1', '8.8.8.8'],
    dnsSearch: ['svc.local', 'docker.internal'],
    dnsOptions: ['ndots:5'],
    memLimitMb,
    memReservationMb,
    cpus: container.environment === 'production' ? 1.5 : 0.75,
    cpuShares: container.environment === 'production' ? 1024 : 512,
    restart,
    profiles: container.environment === 'production' ? ['prod'] : ['dev'],
    ports,
    volumes,
    labels: {
      'com.docker.compose.project': container.projectId,
      'com.docker.compose.service': container.serviceId,
      'traefik.enable': 'true',
      'orchestrator.runtime': orchestrator,
    },
    rawYaml,
  }
}

export function getMockContainerInspectDetail(container: DockerContainer, image?: DockerImage | null): DockerContainerInspectDetail {
  const layers = image ? getMockImageLayers(image.id) : []
  const runtimeConfig: DockerContainerInspectDetail['runtimeConfig'] = {
    user: 'node',
    workingDir: '/app',
    entrypoint: ['/usr/local/bin/node'],
    command: ['server.js'],
    restartPolicy: container.environment === 'production' ? 'unless-stopped' : 'on-failure',
    restartMaxRetries: container.environment === 'production' ? null : 5,
    privileged: false,
    readOnlyRootFs: false,
    oomKillDisable: false,
    ipcMode: 'private',
    pidMode: null,
    networkMode: 'bridge',
    cgroupnsMode: 'private',
    watchMode: container.environment === 'production' ? 'disabled' : 'nodemon',
    healthcheckCommand: 'curl -f http://localhost:3000/health || exit 1',
    healthcheckIntervalSec: 30,
    healthcheckTimeoutSec: 5,
    healthcheckRetries: 3,
  }

  return {
    containerId: container.id,
    generatedAt: iso(0),
    layers,
    processes: getMockContainerProcesses(container.id),
    streamingLogsSupported: true,
    networkConfig: toContainerNetworkAttachment(container),
    portMappings: toContainerPortMappings(container),
    mounts: toContainerMounts(container),
    environment: toContainerEnvVars(container),
    runtimeConfig,
    composeConfig: toContainerComposeConfig(container),
  }
}

export function getMockStackServiceGraph(stack: DockerStack): DockerStackServiceGraph {
  const nodes = stack.services.slice(0, 10).map((service) => ({
    id: service.serviceId,
    label: service.serviceId.slice(0, 18),
    status: service.status,
  }))

  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[Math.max(0, index)]?.id ?? node.id,
    to: node.id,
    relation: index % 2 === 0 ? 'depends_on' : 'links',
  }))

  return { nodes, edges }
}

export function getMockStackLogs(stackId: string): DockerStackLogEntry[] {
  const seed = stackId.slice(0, 8)
  const degraded = hashSeed(stackId) % 3 === 1
  return [
    { id: `${seed}-slog-1`, service: 'gateway', level: 'info', message: 'Service started and listening on :8080', timestamp: iso(12) },
    { id: `${seed}-slog-2`, service: 'api', level: 'info', message: 'Migration check passed', timestamp: iso(10) },
    { id: `${seed}-slog-3`, service: 'worker', level: degraded ? 'error' : 'warn', message: degraded ? 'Worker crashed after memory pressure event' : 'Retrying failed task batch id=45', timestamp: iso(9) },
    { id: `${seed}-slog-4`, service: 'api', level: degraded ? 'warn' : 'error', message: degraded ? 'Transient 502 from dependency, auto-retrying' : 'Rate-limit exceeded on upstream provider', timestamp: iso(7) },
    { id: `${seed}-slog-5`, service: 'gateway', level: 'info', message: 'Configuration reloaded from compose labels', timestamp: iso(4) },
  ]
}

export function getMockStackGitSyncState(stack: DockerStack): DockerStackGitSyncState {
  const webhookStatus: DockerStackGitSyncState['webhookStatus'] =
    stack.status === 'failed'
      ? 'error'
      : stack.status === 'degraded' || stack.status === 'paused'
        ? 'missing'
        : 'configured'

  return {
    repositoryUrl: `git@github.com:mock/${stack.projectId}.git`,
    branch: stack.status === 'failed' ? 'hotfix/recover' : 'main',
    lastCommit: `${stack.id.replace(/[^a-z0-9]/gi, '').slice(0, 7)}cafe`,
    lastSyncAt: stack.status === 'failed' ? iso(120) : iso(14),
    autoDeployOnPush: stack.status !== 'paused',
    webhookStatus,
  }
}

export function getMockOperationProgress(resourceType: DockerOperationProgressItem['resourceType']): DockerOperationProgressItem[] {
  const actionMap: Record<DockerOperationProgressItem['resourceType'], string[]> = {
    containers: ['start', 'restart', 'remove'],
    images: ['pull', 'scan', 'push'],
    networks: ['connect', 'disconnect', 'prune'],
    volumes: ['backup', 'clone', 'prune'],
    registry: ['sync', 'copy', 'validate-auth'],
    stacks: ['deploy', 'update', 'sync-git'],
  }

  const resources = {
    containers: MOCK_DOCKER_CONTAINERS_REALISTIC.slice(0, 3).map((x) => x.name),
    images: MOCK_DOCKER_IMAGES_REALISTIC.slice(0, 3).map((x) => `${x.repository}:${x.tag ?? 'latest'}`),
    networks: MOCK_DOCKER_NETWORKS_REALISTIC.slice(0, 3).map((x) => x.name),
    volumes: MOCK_DOCKER_VOLUMES_REALISTIC.slice(0, 3).map((x) => x.name),
    registry: MOCK_DOCKER_REGISTRIES_REALISTIC.slice(0, 3).map((x) => x.name),
    stacks: MOCK_DOCKER_STACKS_REALISTIC.slice(0, 3).map((x) => x.name),
  }[resourceType]

  const actions = actionMap[resourceType]

  return [0, 1, 2].map((index) => ({
    id: `${resourceType}-op-${String(index + 1)}`,
    action: actions[index] ?? 'reconcile',
    resourceName: resources[index] ?? `${resourceType}-${String(index + 1)}`,
    resourceType,
    status: index === 0 ? 'running' : index === 1 ? 'queued' : resourceType === 'registry' || resourceType === 'stacks' ? 'failed' : 'success',
    progress: index === 0 ? 68 : index === 1 ? 12 : resourceType === 'registry' || resourceType === 'stacks' ? 73 : 100,
    updatedAt: iso(index * 3 + 1),
  }))
}