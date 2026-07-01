import { dockerContainerLogEntrySchema, type DockerContainerLogEntry } from '@repo/contracts-entities'

function inferLogLevel(message: string): DockerContainerLogEntry['level'] {
  if (/\b(error|fatal|panic)\b/iu.test(message)) return 'error'
  if (/\b(warn|warning)\b/iu.test(message)) return 'warn'
  return 'info'
}

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used to walk nested log payloads without
 * an `as Record<string, unknown>` cast.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function coerceContainerLogEntry(payload: unknown): DockerContainerLogEntry | null {
  const direct = dockerContainerLogEntrySchema.safeParse(payload)
  if (direct.success) {
    return direct.data
  }

  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  if (!isRecord(payload)) return null
  const record = payload

  const rawMessage =
    typeof record.message === 'string'
      ? record.message
      : typeof record.log === 'string'
        ? record.log
        : typeof record.line === 'string'
          ? record.line
          : typeof record.data === 'string'
            ? record.data
            : null

  if (!rawMessage) {
    return null
  }

  const timestampSource =
    typeof record.timestamp === 'string' || typeof record.timestamp === 'number'
      ? record.timestamp
      : typeof record.time === 'string' || typeof record.time === 'number'
        ? record.time
        : typeof record.at === 'string' || typeof record.at === 'number'
          ? record.at
          : Date.now()

  const parsedTimestamp = new Date(timestampSource)
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString()

  const stream = record.stream === 'stderr' ? 'stderr' : 'stdout'
  const level =
    record.level === 'error' || record.level === 'warn' || record.level === 'info'
      ? record.level
      : inferLogLevel(rawMessage)

  const id =
    typeof record.id === 'string' && record.id.length > 0
      ? record.id
      : `${timestamp}:${stream}:${level}:${rawMessage.slice(0, 120)}`

  return {
    id,
    timestamp,
    stream,
    level,
    message: rawMessage,
  }
}

export function extractContainerLogEntries(payload: unknown, depth = 0): DockerContainerLogEntry[] {
  if (depth > 5) {
    return []
  }

  const direct = coerceContainerLogEntry(payload)
  if (direct) {
    return [direct]
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      return extractContainerLogEntries(parsed, depth + 1)
    } catch {
      return []
    }
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => extractContainerLogEntries(entry, depth + 1))
  }

  if (typeof payload !== 'object' || payload === null) {
    return []
  }

  if (!isRecord(payload)) return []
  const record = payload
  const nestedCandidates = [
    record.body,
    record.data,
    record.payload,
    record.event,
    record.result,
    record.value,
    record.entry,
    record.entries,
    record.items,
    record.chunk,
  ]

  return nestedCandidates.flatMap((candidate) => extractContainerLogEntries(candidate, depth + 1))
}
