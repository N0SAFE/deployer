import { createHash } from 'node:crypto'

import {
    dockerRuntimeActivityEntitySchema,
    dockerRuntimeEventSchema,
    dockerRuntimeEventSourceSchema,
    type DockerRuntimeActivityEntity,
    type DockerRuntimeEvent,
} from '@deployer/contracts-entities'
import { isRecord } from '@deployer/type-guards'

/**
 * How a runtime event becomes an activity entry: its status, severity, message, progress and fingerprint. Pure.
 */

export function toNullableNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export function toTimestampDate(value: string): Date | null {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function toProgress(value: string | undefined): number | null {
    if (typeof value !== 'string') {
        return null
    }

    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
        return null
    }

    if (parsed <= 0) return 0
    if (parsed >= 100) return 100
    return Math.round(parsed)
}

export function inferRuntimeActivityStatus(
    action: string,
    scanState?: string
): 'queued' | 'running' | 'completed' | 'error' | 'info' {
    const normalizedAction = action.toLowerCase()
    const normalizedState = scanState?.toLowerCase()

    if (normalizedState === 'queued' || normalizedAction.includes('queued')) {
        return 'queued'
    }

    if (
        normalizedState === 'error' ||
        normalizedAction.includes('error') ||
        normalizedAction.includes('fail')
    ) {
        return 'error'
    }

    if (
        normalizedState === 'completed' ||
        normalizedAction.includes('complete') ||
        normalizedAction.includes('done')
    ) {
        return 'completed'
    }

    if (
        normalizedAction.includes('start') ||
        normalizedAction.includes('progress') ||
        normalizedAction.includes('pull') ||
        normalizedAction.includes('create') ||
        normalizedAction.includes('update')
    ) {
        return 'running'
    }

    return 'info'
}

export function inferRuntimeActivitySeverity(
    action: string
): 'info' | 'warning' | 'error' {
    const normalizedAction = action.toLowerCase()
    if (
        normalizedAction.includes('error') ||
        normalizedAction.includes('fail')
    ) {
        return 'error'
    }

    if (
        normalizedAction.includes('die') ||
        normalizedAction.includes('kill') ||
        normalizedAction.includes('destroy') ||
        normalizedAction.includes('delete') ||
        normalizedAction.includes('remove')
    ) {
        return 'warning'
    }

    return 'info'
}

export function resolveRuntimeActivityMessage(
    event: DockerRuntimeEvent
): string | null {
    const payload: Record<string, unknown> = isRecord(event.payload)
        ? event.payload
        : {}
    const candidates = [
        payload.containerName,
        payload.imageName,
        payload.repository,
        payload.networkName,
        payload.volumeName,
        payload.serviceName,
    ]

    for (const candidate of candidates) {
        const normalized = toNullableNonEmptyString(candidate)
        if (normalized) {
            return normalized
        }
    }

    return null
}

export function createRuntimeActivityFingerprint(
    event: DockerRuntimeEvent
): string {
    const payload = isRecord(event.payload) ? event.payload : {}
    return createHash('sha1')
        .update(
            [
                event.eventId ?? '',
                event.timestamp,
                event.source,
                event.action,
                event.actorId ?? '',
                JSON.stringify(payload),
            ].join('|')
        )
        .digest('hex')
}

export function parseRuntimeActivitySource(
    value: string
): DockerRuntimeEvent['source'] {
    const parsed = dockerRuntimeEventSourceSchema.safeParse(value)
    return parsed.success ? parsed.data : 'unknown'
}

/**
 * The row to insert for a runtime event: flow ids (image scans chain queue -> run), status, severity,
 * progress and the fingerprint the insert de-duplicates on.
 */
export function buildRuntimeActivityRecord(
    rawEvent: DockerRuntimeEvent,
    now: Date
) {
    const event = dockerRuntimeEventSchema.parse(rawEvent)
    const actorId =
        typeof event.actorId === 'string' && event.actorId.trim().length > 0
            ? event.actorId.trim()
            : null
    const isImageScanEvent =
        event.source === 'image' && event.action.startsWith('scan_')

    return {
        eventFingerprint: createRuntimeActivityFingerprint(event),
        eventId: event.eventId,
        flowId: isImageScanEvent
            ? `image-scan-run:${actorId ?? 'unknown'}`
            : `${event.source}:${actorId ?? event.eventId ?? 'event'}`,
        dependsOnFlowId:
            isImageScanEvent && event.action !== 'scan_queued'
                ? `image-scan-queue:${actorId ?? 'unknown'}`
                : null,
        source: event.source,
        action: event.action,
        actorId,
        status: inferRuntimeActivityStatus(
            event.action,
            event.actorAttributes.scanState
        ),
        category: isImageScanEvent
            ? ('image-scanning' as const)
            : ('runtime-event' as const),
        severity: inferRuntimeActivitySeverity(event.action),
        progress: toProgress(event.actorAttributes.scanProgress),
        stage:
            toNullableNonEmptyString(event.actorAttributes.scanStage) ??
            toNullableNonEmptyString(event.actorAttributes.scanState),
        scanner: toNullableNonEmptyString(event.actorAttributes.scanScanner),
        message:
            toNullableNonEmptyString(event.actorAttributes.scanMessage) ??
            toNullableNonEmptyString(event.actorAttributes.scanError) ??
            resolveRuntimeActivityMessage(event),
        actorAttributes: event.actorAttributes,
        payload: isRecord(event.payload) ? event.payload : {},
        raw: event.raw,
        occurredAt: toTimestampDate(event.timestamp) ?? now,
        createdAt: now,
        updatedAt: now,
    }
}

export interface RuntimeActivityRow {
    id: string
    eventId: string | null
    eventFingerprint: string
    flowId: string
    dependsOnFlowId: string | null
    source: string
    action: string
    actorId: string | null
    status: string
    category: string
    severity: string
    progress: number | null
    stage: string | null
    scanner: string | null
    message: string | null
    actorAttributes: unknown
    payload: unknown
    raw: unknown
    occurredAt: Date
    createdAt: Date
    updatedAt: Date
}

/**
 * A persisted row as the contract entity. Persisted rows predate the swarm enrichment (the columns do not
 * exist yet), so a rehydrated activity carries no live swarm state: the live stream is where enrichment
 * applies, history is what it was recorded as.
 */
export function toRuntimeActivityEntity(
    row: RuntimeActivityRow
): DockerRuntimeActivityEntity {
    return dockerRuntimeActivityEntitySchema.parse({
        id: row.id,
        eventId: row.eventId,
        eventFingerprint: row.eventFingerprint,
        flowId: row.flowId,
        dependsOnFlowId: row.dependsOnFlowId,
        source: parseRuntimeActivitySource(row.source),
        action: row.action,
        actorId: row.actorId,
        status: row.status,
        category: row.category,
        severity: row.severity,
        progress: row.progress,
        stage: row.stage,
        scanner: row.scanner,
        message: row.message,
        actorAttributes: row.actorAttributes,
        payload: row.payload,
        raw: row.raw,
        occurredAt: row.occurredAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        swarmTasks: [],
        swarmService: null,
    })
}
