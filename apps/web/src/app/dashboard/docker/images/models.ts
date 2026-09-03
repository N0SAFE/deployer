import type { DockerDeploymentSnapshot, DockerImage } from '@repo/contracts-entities'

export type DockerImageEntity = DockerImage
export type DockerImageDeployment = Pick<DockerDeploymentSnapshot, 'containerImage' | 'status'>

// NOTE: `type` aliases (not `interface`) so rows satisfy the DataTable's
// `ExportableData` (`Record<string, unknown>`) constraint — interfaces lack
// the implicit index signature that type aliases get.

export type ImageTagRow = Pick<DockerImageEntity, 'id' | 'sizeBytes' | 'createdAt' | 'lastSeenAt'> & {
  rowId: string
  imageRef: string
  tag: string
  shortId: string
  usageCount: number
  successful: number
  failed: number
}

export type ImageGroupRow = {
  rowId: string
  repositoryKey: string
  repositoryLabel: string
  tagsCount: number
  totalSizeBytes: number
  usageCount: number
  successful: number
  failed: number
  lastSeenAt: string
  subRows: ImageTagRow[]
}

export interface TagSelectionOption {
  value: string
  label: string
  description: string
}

function isPlaceholderImageSegment(value: unknown): boolean {
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 || normalized === 'undefined' || normalized === 'null' || normalized === 'none' || normalized === 'nan'
}

function normalizeRegistryForDisplay(value: unknown): string {
  if (typeof value !== 'string' || isPlaceholderImageSegment(value)) {
    return 'docker.io'
  }

  return value.trim()
}

function normalizeRepositoryForDisplay(value: unknown): string {
  if (typeof value !== 'string') {
    return 'library/unknown'
  }

  const segments = value
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => !isPlaceholderImageSegment(segment))

  if (segments.length === 0) {
    return 'library/unknown'
  }

  return segments.join('/')
}

function buildFallbackRepositoryForDisplay(imageId: string): string {
  const normalizedId = imageId.replace(/^sha256:/, '').trim()
  const shortId = normalizedId.length > 0 ? normalizedId.slice(0, 12) : 'unknown'
  return `untagged/${shortId}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function buildImageGroupRows(
  deployments: readonly DockerImageDeployment[],
  imageEntities: readonly DockerImageEntity[],
): ImageGroupRow[] {
  const deploymentStatsByImageRef = new Map<string, { usage: number; successful: number; failed: number }>()

  for (const deployment of deployments) {
    const imageRef = deployment.containerImage ?? 'unresolved-image'
    const stats = deploymentStatsByImageRef.get(imageRef) ?? { usage: 0, successful: 0, failed: 0 }
    stats.usage += 1
    if (deployment.status === 'success') stats.successful += 1
    if (deployment.status === 'failed') stats.failed += 1
    deploymentStatsByImageRef.set(imageRef, stats)
  }

  const grouped = new Map<string, ImageGroupRow>()

  for (const image of imageEntities) {
    const normalizedRegistry = normalizeRegistryForDisplay(image.registry)
    const normalizedRepository = normalizeRepositoryForDisplay(image.repository)
    const hasUnknownRepository = normalizedRepository === 'library/unknown'
    const repositoryForDisplay = hasUnknownRepository
      ? buildFallbackRepositoryForDisplay(image.id)
      : normalizedRepository
    const registryForDisplay = hasUnknownRepository ? 'local' : normalizedRegistry

    const repositoryKey = `${registryForDisplay}/${repositoryForDisplay}`
    const normalizedTag = typeof image.tag === 'string' && image.tag.trim().length > 0 ? image.tag.trim() : null
    const tag = normalizedTag ?? '<untagged>'
    const imageRef = normalizedTag ? `${repositoryKey}:${normalizedTag}` : image.id
    const stats = deploymentStatsByImageRef.get(imageRef)

    const tagRow: ImageTagRow = {
      rowId: image.id,
      id: image.id,
      imageRef,
      tag,
      shortId: image.id.slice(0, 12),
      sizeBytes: image.sizeBytes,
      createdAt: image.createdAt,
      lastSeenAt: image.lastSeenAt,
      usageCount: stats?.usage ?? 0,
      successful: stats?.successful ?? 0,
      failed: stats?.failed ?? 0,
    }

    const existing = grouped.get(repositoryKey)
    if (!existing) {
      grouped.set(repositoryKey, {
        rowId: image.id,
        repositoryKey,
        repositoryLabel: repositoryForDisplay,
        subRows: [tagRow],
        tagsCount: 1,
        totalSizeBytes: image.sizeBytes ?? 0,
        usageCount: tagRow.usageCount,
        successful: tagRow.successful,
        failed: tagRow.failed,
        lastSeenAt: tagRow.lastSeenAt,
      })
      continue
    }

    existing.subRows.push(tagRow)
    existing.tagsCount += 1
    existing.totalSizeBytes += image.sizeBytes ?? 0
    existing.usageCount += tagRow.usageCount
    existing.successful += tagRow.successful
    existing.failed += tagRow.failed

    if (new Date(tagRow.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = tagRow.lastSeenAt
    }
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      subRows: [...group.subRows].sort((a, b) => {
        if (a.tag === 'latest') return -1
        if (b.tag === 'latest') return 1
        if (a.tag === '<untagged>') return 1
        if (b.tag === '<untagged>') return -1
        return a.tag.localeCompare(b.tag)
      }),
    }))
    .sort((a, b) => b.usageCount - a.usageCount)
}
