import { dockerContainerLogEntrySchema, type DockerContainerLogEntry } from '@deployer/contracts-entities'
import { isRecord } from '@deployer/type-guards'

const DOCKER_TIMESTAMP_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/u
const DOCKER_TIMESTAMP_BOUNDARY_REGEX = /(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s)/gu

const NESTED_PAYLOAD_KEYS = ['body', 'data', 'payload', 'event', 'result', 'value', 'entry', 'entries', 'items', 'chunk'] as const

export function inferLogLevel(message: string): DockerContainerLogEntry['level'] {
  if (/\b(error|fatal|panic)\b/iu.test(message)) return 'error'
  if (/\b(warn|warning)\b/iu.test(message)) return 'warn'
  return 'info'
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return null
}

function pickTimestamp(record: Record<string, unknown>): string | number {
  for (const key of ['timestamp', 'time', 'at'] as const) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') return value
  }
  return Date.now()
}

/** Accepts a strict log entry or a loosely shaped payload (message/log/line/data) and returns a normalised entry. */
export function coerceContainerLogEntry(payload: unknown): DockerContainerLogEntry | null {
  const direct = dockerContainerLogEntrySchema.safeParse(payload)
  if (direct.success) return direct.data
  if (typeof payload !== 'object' || payload === null) return null

  const record = isRecord(payload) ? payload : {}
  const rawMessage = pickString(record, ['message', 'log', 'line', 'data'])
  if (!rawMessage) return null

  const parsedTimestamp = new Date(pickTimestamp(record))
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString()
  const stream = record.stream === 'stderr' ? 'stderr' : 'stdout'
  const level = record.level === 'error' || record.level === 'warn' || record.level === 'info'
    ? record.level
    : inferLogLevel(rawMessage)
  const id = typeof record.id === 'string' && record.id.length > 0
    ? record.id
    : `${timestamp}:${stream}:${level}:${rawMessage.slice(0, 120)}`

  return { id, timestamp, stream, level, message: rawMessage }
}

/** Walks an arbitrarily wrapped stream payload and collects every log entry found in it. */
export function extractContainerLogEntries(payload: unknown, depth = 0): DockerContainerLogEntry[] {
  if (depth > 5) return []

  const direct = coerceContainerLogEntry(payload)
  if (direct) return [direct]

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return []
    try {
      return extractContainerLogEntries(JSON.parse(trimmed) as unknown, depth + 1)
    } catch {
      return []
    }
  }

  if (Array.isArray(payload)) return payload.flatMap((entry) => extractContainerLogEntries(entry, depth + 1))
  if (typeof payload !== 'object' || payload === null) return []

  const record = isRecord(payload) ? payload : {}
  return NESTED_PAYLOAD_KEYS.flatMap((key) => extractContainerLogEntries(record[key], depth + 1))
}

/** Last-resort human readable message for a payload that carried no recognisable log entry. */
export function resolveFallbackPayloadMessage(payload: unknown, depth = 0): string | null {
  if (depth > 6 || payload == null) return null

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return resolveFallbackPayloadMessage(JSON.parse(trimmed) as unknown, depth + 1)
      } catch {
        return trimmed
      }
    }
    return trimmed
  }

  if (typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint') return String(payload)
  if (typeof payload !== 'object') return null

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const nested = resolveFallbackPayloadMessage(entry, depth + 1)
      if (nested) return nested
    }
    return null
  }

  const record = isRecord(payload) ? payload : {}
  for (const key of ['message', 'log', 'line'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  for (const key of NESTED_PAYLOAD_KEYS) {
    const nested = resolveFallbackPayloadMessage(record[key], depth + 1)
    if (nested) return nested
  }

  try {
    const serialized = JSON.stringify(payload)
    return serialized && serialized.length > 0 ? serialized : null
  } catch {
    return null
  }
}

/** Splits an entry whose message holds several (timestamp-prefixed) lines into one entry per line. */
export function explodeCompositeLogEntry(entry: DockerContainerLogEntry): DockerContainerLogEntry[] {
  const normalizedMessage = entry.message.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (normalizedMessage.length === 0) return [entry]

  const lineReadyMessage = normalizedMessage.includes('\n')
    ? normalizedMessage
    : normalizedMessage.replace(DOCKER_TIMESTAMP_BOUNDARY_REGEX, '\n').trimStart()

  const lines = lineReadyMessage.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length <= 1) return [{ ...entry, message: normalizedMessage }]

  return lines.map((line, index) => {
    const timestampMatch = DOCKER_TIMESTAMP_PREFIX_REGEX.exec(line)
    const timestamp = timestampMatch?.[1] ? new Date(timestampMatch[1]).toISOString() : entry.timestamp
    const message = timestampMatch?.[2] ?? line
    const level: DockerContainerLogEntry['level'] = /\b(error|fatal|panic)\b/iu.test(message)
      ? 'error'
      : /\b(warn|warning)\b/iu.test(message)
        ? 'warn'
        : entry.level
    const stream: DockerContainerLogEntry['stream'] = /\bstderr\b/iu.test(message) ? 'stderr' : entry.stream

    return { ...entry, id: `${entry.id}:${String(index)}`, timestamp, stream, level, message }
  })
}

export function parseLogTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** De-duplicates by timestamp|stream|message, sorts chronologically and keeps the newest `limit` entries. */
export function mergeContainerLogsWithLimit(entries: DockerContainerLogEntry[], limit: number): DockerContainerLogEntry[] {
  if (entries.length === 0) return entries

  const dedupedByKey = new Map<string, DockerContainerLogEntry>()
  for (const entry of entries) {
    dedupedByKey.set(`${entry.timestamp}|${entry.stream}|${entry.message}`, entry)
  }

  const ordered = Array.from(dedupedByKey.values()).sort(
    (left, right) => parseLogTimestamp(left.timestamp) - parseLogTimestamp(right.timestamp),
  )
  return ordered.length <= limit ? ordered : ordered.slice(-limit)
}

const FALLBACK_MESSAGE_MAX_LENGTH = 2_000

/** Turns raw stream payloads into log entries, falling back to a synthetic entry when none can be parsed. */
export function normalizeLogStreamPayloads(
  payloads: unknown[],
  containerId: string,
  onFallback?: (payloadIndex: number, preview: string) => void,
): DockerContainerLogEntry[] {
  const normalizedEntries: DockerContainerLogEntry[] = []

  payloads.forEach((payload, payloadIndex) => {
    const extracted = extractContainerLogEntries(payload).flatMap((entry) => explodeCompositeLogEntry(entry))

    if (extracted.length === 0) {
      const fallbackMessage = resolveFallbackPayloadMessage(payload)
      if (fallbackMessage) {
        const message = fallbackMessage.length > FALLBACK_MESSAGE_MAX_LENGTH
          ? `${fallbackMessage.slice(0, FALLBACK_MESSAGE_MAX_LENGTH)}…`
          : fallbackMessage
        normalizedEntries.push({
          id: `modal:${containerId}:fallback:${String(payloadIndex)}:${message.slice(0, 120)}`,
          timestamp: new Date().toISOString(),
          stream: 'stdout',
          level: 'info',
          message,
        })
        onFallback?.(payloadIndex, message.slice(0, 180))
      }
    }

    normalizedEntries.push(...extracted)
  })

  return normalizedEntries
}
