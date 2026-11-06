import { createHmac } from 'node:crypto'

import type {
    MeshNodeConfig,
    MeshNodeSecret,
    MeshSecretAdoption,
} from '@deployer/node-agent-contracts'

/** Keyed so a fingerprint is not a bare hash of the secret, and versioned so the scheme can change. */
const FINGERPRINT_KEY = 'deployer:secret-fingerprint:v1'

/** A short, comparable digest of a secret. 12 hex characters: enough to tell values apart, not enough to be used as one. */
export function fingerprintOf(secret: string): string {
    return createHmac('sha256', FINGERPRINT_KEY)
        .update(secret)
        .digest('hex')
        .slice(0, 12)
}

type Held = {
    readonly value: string | null
    readonly adoptedAt: string | null
    readonly generation: number | null
    readonly earlier: readonly number[]
}

const present = (held: Held): MeshNodeSecret['fingerprint'] =>
    held.value === null || held.value === '' ? null : fingerprintOf(held.value)

/**
 * What this node says it holds, and what reads it. The consumers are declared HERE, next to the secrets, because this is
 * where a reader of the inventory learns what a rotation would touch.
 */
export function secretInventoryOf(
    config: MeshNodeConfig | null
): MeshNodeSecret[] {
    const platform: Held = {
        value: config?.platformSecret ?? null,
        adoptedAt: config?.platformSecretUpdatedAt ?? null,
        generation: config?.platformSecretGeneration ?? null,
        earlier: (config?.platformSecretPrevious ?? []).map(
            (entry) => entry.generation
        ),
    }
    return [
        {
            id: 'platform',
            purpose: 'Signs sessions and service-to-service claims, and seals stored credentials',
            fingerprint: present(platform),
            generation: platform.generation,
            earlierGenerations: [...platform.earlier],
            adoptedAt: platform.adoptedAt,
            consumers: [
                'Better Auth sessions',
                'system-actor claims',
                'column encryption',
                'ingress token',
            ],
        },
    ]
}

/**
 * Which nodes hold the value the fleet has settled on, which hold another, and which hold none.
 *
 * For a secret that rotates, "settled on" is the HIGHEST generation: a node on a lower one is behind, which is exact (SEC-101).
 * Several values on the highest generation are a disagreement, settled by the majority and the most recent adoption, and the
 * ones that differ are flagged. For a secret that does not rotate yet there is no generation, so it is the majority alone,
 * because no node is the source of truth (mesh first). A split fleet is shown, never guessed away.
 */
export function adoptionOf(
    nodes: readonly { readonly nodeId: string; readonly secrets: readonly MeshNodeSecret[] }[]
): MeshSecretAdoption[] {
    const ids = [...new Set(nodes.flatMap((node) => node.secrets.map((secret) => secret.id)))]
    return ids.map((id) => {
        const held = nodes.map((node) => {
            const secret = node.secrets.find((candidate) => candidate.id === id)
            return {
                nodeId: node.nodeId,
                fingerprint: secret?.fingerprint ?? null,
                generation: secret?.generation ?? null,
                adoptedAt: secret?.adoptedAt ?? null,
            }
        })
        const top = Math.max(0, ...held.flatMap((entry) => (entry.fingerprint === null || entry.generation === null ? [] : [entry.generation])))
        const candidates = held.filter(
            (entry) =>
                entry.fingerprint !== null && (top === 0 || entry.generation === top)
        )
        const tally = new Map<string, { count: number; latest: string }>()
        for (const { fingerprint, adoptedAt } of candidates) {
            if (fingerprint === null) continue
            const seen = tally.get(fingerprint)
            tally.set(fingerprint, {
                count: (seen?.count ?? 0) + 1,
                latest: [seen?.latest ?? '', adoptedAt ?? ''].sort().at(-1) ?? '',
            })
        }
        const current =
            [...tally.entries()].sort(
                ([, a], [, b]) => b.count - a.count || b.latest.localeCompare(a.latest)
            )[0]?.[0] ?? null
        return {
            id,
            current,
            currentGeneration: top === 0 ? null : top,
            nodes: held.map((entry) => ({
                ...entry,
                status: statusOf(entry.fingerprint, current),
            })),
        }
    })
}

const statusOf = (
    fingerprint: string | null,
    current: string | null
): MeshSecretAdoption['nodes'][number]['status'] =>
    fingerprint === null
        ? 'missing'
        : fingerprint === current
          ? 'current'
          : 'stale'
