import { describe, expect, it } from 'vitest'

import { accessOf } from '@deployer/auth/authz/meta'
import { fleetServiceContract } from '@deployer/fleet-contracts'

/**
 * Which fleet namespaces already carry an authorization declaration (`SEC-064`), and which do not yet.
 *
 * The gate treats an undeclared procedure as a bug and, in `shadow`, only logs it — so a route added without a
 * declaration keeps serving every signed-in caller. This checks the namespaces that ARE covered and names the rest, so
 * closing one is a one-line move from `PENDING` to `COVERED` rather than an act of memory.
 */

/** Namespaces where every procedure declares what it requires. */
const COVERED = ['cluster', 'nodes'] as const

/** Namespaces still undeclared, with why. */
const PENDING = new Map<string, string>([
    [
        'platform',
        'app instances: register/heartbeat are credential-gated, the console routes need a mapping decision',
    ],
    [
        'providerSchema',
        'static provider/buildler schemas the UI renders from; `registry:read` is the likely answer',
    ],
    [
        'providers',
        'code + DNS + GitHub app providers: `registry:*` for code, `dns.provider:*` for DNS, GitHub apps unclassified',
    ],
    [
        'reachability',
        'edge/network configuration: `edge:read`/`edge:manage` is the likely answer, plus `mesh:operate` for revoke',
    ],
])

function isProcedure(node: unknown): node is object {
    if (node === null || typeof node !== 'object') return false
    const orpc = (node as { readonly '~orpc'?: Record<string, unknown> })[
        '~orpc'
    ]
    return orpc !== undefined && 'inputSchemas' in orpc
}

function procedures(
    node: unknown,
    path: string[] = []
): { path: string[]; node: unknown }[] {
    if (isProcedure(node)) return [{ path, node }]
    if (node === null || typeof node !== 'object') return []
    return Object.entries(node).flatMap(([key, value]) =>
        procedures(value, [...path, key])
    )
}

describe('fleet authz declarations', () => {
    const mounted = procedures(fleetServiceContract)

    it('covers the namespaces it claims to cover', () => {
        for (const namespace of COVERED) {
            const found = mounted.filter((entry) => entry.path[0] === namespace)
            expect(
                found.length,
                `${namespace} has no procedures`
            ).toBeGreaterThan(0)

            const undeclared = found
                .filter((entry) => accessOf(entry.node) === undefined)
                .map((entry) => entry.path.join('.'))

            expect(undeclared).toEqual([])
        }
    })

    it('keeps the pending list honest: nothing marked pending already declares access', () => {
        const stale = mounted
            .filter(
                (entry) =>
                    entry.path.length > 1 && PENDING.has(entry.path[0] ?? '')
            )
            .filter((entry) => accessOf(entry.node) !== undefined)
            .map((entry) => entry.path.join('.'))

        expect(stale).toEqual([])
    })

    it('names a permission or `self` on every covered declaration', () => {
        const shapeless = mounted
            .filter((entry) =>
                COVERED.includes(entry.path[0] as (typeof COVERED)[number])
            )
            .map(
                (entry) => [entry.path.join('.'), accessOf(entry.node)] as const
            )
            .filter(([, declaration]) => {
                const value = declaration as
                    | { permission?: unknown; self?: unknown; public?: unknown }
                    | undefined
                return (
                    value !== undefined &&
                    value.permission === undefined &&
                    value.self !== true &&
                    value.public !== true
                )
            })
            .map(([path]) => path)

        expect(shapeless).toEqual([])
    })
})
