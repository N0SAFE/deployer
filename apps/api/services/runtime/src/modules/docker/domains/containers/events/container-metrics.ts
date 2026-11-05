/**
 * Turning the engine's container stats into metric events: the selector a stream asks for, the pool key it shares,
 * summing network and block-IO counters, and building the event. Pure, so the arithmetic is tested without an engine.
 */
import {
    dockerContainerRuntimeEventSchema,
    type DockerRuntimeEvent,
} from '@deployer/contracts-entities'
import { isRecord } from '@deployer/type-guards'

import {
    collectFieldFilterValues,
    matchesIdentifier,
    type RuntimeEventFilterNode,
} from '../../../common/runtime/runtime-event-filter'

import type * as systeminformation from 'systeminformation'

export type ContainerMetricsSelector = {
    containerIds?: string[]
    containerNames?: string[]
}

export function buildMetricsPoolKey(
    selector: ContainerMetricsSelector,
    intervalMs: number
): string {
    const ids = (selector.containerIds ?? []).slice().sort()
    const names = (selector.containerNames ?? []).slice().sort()

    return [
        'docker-container-metrics',
        `interval:${String(intervalMs)}`,
        `ids:${ids.join(',') || '*'}`,
        `names:${names.join(',') || '*'}`,
    ].join('|')
}

export function extractContainerSelector(
    filterNode: RuntimeEventFilterNode | undefined
): ContainerMetricsSelector {
    if (!filterNode) {
        return {}
    }

    const containerIds = new Set<string>()
    const containerNames = new Set<string>()

    collectFieldFilterValues(filterNode, 'containerId', containerIds)
    collectFieldFilterValues(filterNode, 'containerName', containerNames)

    return {
        containerIds: containerIds.size > 0 ? [...containerIds] : undefined,
        containerNames:
            containerNames.size > 0 ? [...containerNames] : undefined,
    }
}

export function matchesSelector(
    sample: systeminformation.Systeminformation.DockerContainerData,
    selector: ContainerMetricsSelector
): boolean {
    const sampleRecord = isRecord(sample) ? sample : {}
    const sampleId = readString(sampleRecord, ['id', 'containerId'])
    const sampleName =
        readString(sampleRecord, ['name', 'containerName']) ??
        readStringArrayFirst(sampleRecord, ['names'])

    const hasIdFilter =
        !!selector.containerIds && selector.containerIds.length > 0
    const hasNameFilter =
        !!selector.containerNames && selector.containerNames.length > 0

    const idMatches =
        !hasIdFilter ||
        (sampleId !== null &&
            !!selector.containerIds?.some((candidateId) =>
                matchesIdentifier(sampleId, candidateId)
            ))
    const nameMatches =
        !hasNameFilter ||
        (sampleName !== null && !!selector.containerNames?.includes(sampleName))

    return idMatches && nameMatches
}

export function normalizePercent(value: number): number {
    if (!Number.isFinite(value)) {
        return 0
    }

    return Math.max(0, Math.min(100, value))
}

export function readByPath(
    source: Record<string, unknown>,
    path: string
): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (
            typeof current === 'object' &&
            current !== null &&
            segment in (isRecord(current) ? current : {})
        ) {
            return (isRecord(current) ? current : {})[segment]
        }

        return undefined
    }, source)
}

export function readNumber(
    source: Record<string, unknown>,
    fieldPaths: string[]
): number {
    for (const path of fieldPaths) {
        const value = readByPath(source, path)
        const numeric =
            typeof value === 'number'
                ? value
                : typeof value === 'string'
                  ? Number(value)
                  : Number.NaN
        if (Number.isFinite(numeric)) {
            return numeric
        }
    }

    return 0
}

export function readString(
    source: Record<string, unknown>,
    fieldPaths: string[]
): string | null {
    for (const path of fieldPaths) {
        const value = readByPath(source, path)
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    }

    return null
}

export function readStringArrayFirst(
    source: Record<string, unknown>,
    fieldPaths: string[]
): string | null {
    for (const path of fieldPaths) {
        const value = readByPath(source, path)
        if (Array.isArray(value)) {
            const first = value.find(
                (entry): entry is string =>
                    typeof entry === 'string' && entry.length > 0
            )
            if (first) {
                return first
            }
        }
    }

    return null
}

export function sumBlockIoBytes(
    source: Record<string, unknown>,
    op: 'Read' | 'Write'
): number {
    const ioEntries = readByPath(
        source,
        'blkio_stats.io_service_bytes_recursive'
    )
    if (!Array.isArray(ioEntries)) {
        return 0
    }

    return ioEntries.reduce<number>((sum, entry) => {
        if (typeof entry !== 'object' || entry === null) {
            return sum
        }

        const record = isRecord(entry) ? entry : {}
        const entryOp = readString(record, ['op'])
        if (entryOp !== op) {
            return sum
        }

        return sum + readNumber(record, ['value'])
    }, 0)
}

export function sumNetworkBytes(
    source: Record<string, unknown>,
    key: 'rx_bytes' | 'tx_bytes'
): number {
    const networks = readByPath(source, 'networks')
    if (typeof networks !== 'object' || networks === null) {
        return 0
    }

    return Object.values(isRecord(networks) ? networks : {}).reduce<number>(
        (sum, networkStats) => {
            if (typeof networkStats !== 'object' || networkStats === null) {
                return sum
            }

            const numeric = readNumber(
                isRecord(networkStats) ? networkStats : {},
                [key]
            )
            return sum + numeric
        },
        0
    )
}

export function toContainerMetricEvent(
    sample: Record<string, unknown>,
    stats: Record<string, unknown> | undefined,
    timestamp: string,
    nowMs: number
): DockerRuntimeEvent {
    const containerId = readString(sample, ['id', 'containerId']) ?? null
    const containerName =
        readString(sample, ['name', 'containerName']) ??
        readStringArrayFirst(sample, ['names']) ??
        null

    const metrics = {
        at: timestamp,
        cpu: normalizePercent(
            readNumber(stats ?? sample, ['cpuPercent', 'cpu'])
        ),
        memory: normalizePercent(
            readNumber(stats ?? sample, [
                'memPercent',
                'memoryPercent',
                'memory',
            ])
        ),
        networkRxKb:
            readNumber(stats ?? sample, ['netIO.rx', 'netRx', 'rx']) / 1024,
        networkTxKb:
            readNumber(stats ?? sample, [
                'netIO.wx',
                'netIO.tx',
                'netTx',
                'tx',
            ]) / 1024,
        ioReadKb:
            readNumber(stats ?? sample, [
                'blockIO.r',
                'blockIO.read',
                'blockRead',
                'blkRead',
            ]) / 1024,
        ioWriteKb:
            readNumber(stats ?? sample, [
                'blockIO.w',
                'blockIO.write',
                'blockWrite',
                'blkWrite',
            ]) / 1024,
    }

    return dockerContainerRuntimeEventSchema.parse({
        type: 'docker_event',
        source: 'container',
        action: 'metrics',
        actorId: containerId,
        actorAttributes: {
            metricsSource: 'systeminformation',
            status: readString(sample, ['state', 'status']) ?? 'unknown',
        },
        scope: null,
        from: readString(sample, ['image', 'imageName']) ?? null,
        eventId: `metrics-${containerId ?? containerName ?? 'unknown'}-${String(nowMs)}`,
        nodeId: null,
        timestamp,
        timestampNano: null,
        raw: sample,
        payload: {
            containerId,
            containerName,
            image: readString(sample, ['image', 'imageName']) ?? null,
            exitCode: null,
            signal: null,
            metrics,
            metricsSource: 'systeminformation',
        },
    })
}

export function shouldTraceTick(tick: number): boolean {
    return tick <= 10 || tick % 50 === 0
}

export function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}
