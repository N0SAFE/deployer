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
    const mesh: Held = {
        value: config?.meshSharedSecret ?? null,
        adoptedAt: config?.meshSharedSecretUpdatedAt ?? null,
    }
    const platform: Held = {
        value: config?.platformSecret ?? null,
        adoptedAt: config?.platformSecretUpdatedAt ?? null,
    }
    return [
        {
            id: 'mesh',
            purpose: 'Authenticates mesh peers to one another',
            fingerprint: present(mesh),
            adoptedAt: mesh.adoptedAt,
            consumers: ['mesh peer tokens', 'mesh control token'],
        },
        {
            id: 'platform',
            purpose: 'Signs sessions and service-to-service claims, and seals stored credentials',
            fingerprint: present(platform),
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
 * "Settled on" is the majority, because no node is the source of truth (mesh first): a node that disagrees is `stale`
 * whether it is behind or ahead, which is what an operator has to look at either way. Rotation (SEC-101) adds an explicit
 * version, after which "behind" is exact; until then a split fleet is shown, never guessed away.
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
                adoptedAt: secret?.adoptedAt ?? null,
            }
        })
        const tally = new Map<string, { count: number; latest: string }>()
        for (const { fingerprint, adoptedAt } of held) {
            if (fingerprint === null) continue
            const seen = tally.get(fingerprint)
            tally.set(fingerprint, {
                count: (seen?.count ?? 0) + 1,
                latest: [seen?.latest ?? '', adoptedAt ?? ''].sort().at(-1) ?? '',
            })
        }
        const current =
            [...tally.entries()].sort(
                ([, a], [, b]) =>
                    b.count - a.count || b.latest.localeCompare(a.latest)
            )[0]?.[0] ?? null
        return {
            id,
            current,
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
