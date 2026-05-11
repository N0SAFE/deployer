export function shortId(id: string): string {
  return id.slice(0, 8)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

export function truncateMiddle(value: string, maxLength = 9): string {
  const normalized = value.trim()
  if (!normalized) return 'unknown'
  if (normalized.length <= maxLength) return normalized

  const prefixLength = Math.floor((maxLength - 3) / 2)
  const suffixLength = maxLength - 3 - prefixLength

  return `${normalized.slice(0, prefixLength)}...${normalized.slice(-suffixLength)}`
}

export function buildLogContainerLabel(serviceName: string, environment: string, replicaTag: string): string {
  return `${truncateMiddle(serviceName)}:${truncateMiddle(environment)}:${truncateMiddle(replicaTag)}`
}

export function parseContainerIdentity(containerName: string): {
  serviceName: string
  environment: string
  replicaTag: string
} {
  const segments = containerName
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) {
    return {
      serviceName: containerName,
      environment: 'unknown',
      replicaTag: 'primary',
    }
  }

  const working = [...segments]
  const lastSegment = working[working.length - 1]
  let replicaTag = 'primary'

  if (lastSegment && /^\d+$/.test(lastSegment)) {
    replicaTag = `r${lastSegment}`
    working.pop()
  } else if (lastSegment && /^(?:r|replica)[-_]?\d+$/i.test(lastSegment)) {
    const replicaNumber = lastSegment.match(/\d+/)?.[0]
    if (replicaNumber) {
      replicaTag = `r${replicaNumber}`
      working.pop()
    }
  }

  const environment = working.length > 1 ? (working[working.length - 1] ?? 'unknown') : 'unknown'
  const serviceSegments = working.length > 1 ? working.slice(0, -1) : working
  const serviceName = serviceSegments.join('-') || containerName

  return {
    serviceName,
    environment,
    replicaTag,
  }
}
