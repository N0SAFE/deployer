import type { ReplicaRecord, Resolution, ResolveQuery } from './replica-record'

/** FNV-1a, 32 bit: stable across processes, which is what rendezvous hashing needs. */
function hash(text: string): number {
    let value = 0x811c9dc5
    for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index)
        value = Math.imul(value, 0x01000193) >>> 0
    }
    return value >>> 0
}

const byLoadThenId = (a: ReplicaRecord, b: ReplicaRecord) =>
    a.load - b.load || a.replicaId.localeCompare(b.replicaId)

function leastLoaded(
    candidates: readonly ReplicaRecord[]
): ReplicaRecord | undefined {
    return [...candidates].sort(byLoadThenId)[0]
}

/** The replica with the highest score for the key: the same answer on every agent, and stable as replicas come and go. */
function rendezvous(
    candidates: readonly ReplicaRecord[],
    key: string
): ReplicaRecord | undefined {
    let best: ReplicaRecord | undefined
    let bestScore = -1
    for (const candidate of candidates) {
        const score = hash(`${key}\u0000${candidate.replicaId}`)
        if (
            score > bestScore ||
            (score === bestScore &&
                best !== undefined &&
                candidate.replicaId < best.replicaId)
        ) {
            best = candidate
            bestScore = score
        }
    }
    return best
}

/**
 * Picks the replica a call goes to.
 *
 * The order is the design's: the replica that holds the key; else a replica on the agent's own node, so a service
 * replicated here is served from here; else the key's rendezvous replica; else the least loaded.
 */
export function resolveReplica(
    records: readonly ReplicaRecord[],
    query: ResolveQuery
): Resolution | undefined {
    const excluded = new Set(query.exclude ?? [])
    const live = records.filter(
        (record) =>
            record.service === query.service &&
            record.expiresAt > query.now &&
            !excluded.has(record.replicaId) &&
            (query.localOnly !== true || record.nodeId === query.localNode)
    )
    if (live.length === 0) {
        return undefined
    }

    if (query.key !== undefined) {
        const key = query.key
        const holders = live.filter((record) => record.keys.includes(key))
        const holder =
            leastLoaded(
                holders.filter((record) => record.nodeId === query.localNode)
            ) ?? leastLoaded(holders)
        if (holder) {
            return { replica: holder, reason: 'key-holder' }
        }
    }

    const local = leastLoaded(
        live.filter((record) => record.nodeId === query.localNode)
    )
    if (local) {
        return { replica: local, reason: 'local-node' }
    }

    if (query.key !== undefined) {
        const owner = rendezvous(live, query.key)
        if (owner) {
            return { replica: owner, reason: 'affinity' }
        }
    }

    const fallback = leastLoaded(live)
    return fallback ? { replica: fallback, reason: 'least-loaded' } : undefined
}
