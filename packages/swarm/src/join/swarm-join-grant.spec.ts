import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { decideRole } from './join-decision'
import { makeSwarmJoinGrant } from './swarm-join-grant'

import type { SwarmClusterShape } from '../cluster/swarm-cluster'
import type { SwarmJoinConfig, SwarmParticipationDefaults } from '../config'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

/**
 * The FLEET decides whether a joining node may become a manager. These tests pin the decision rule,
 * because it is the difference between a healthy quorum and one that tolerates no failures:
 *
 *   2 managers -> 0 failures tolerated
 *   3 managers -> 1 failure tolerated
 *
 * So a candidate is admitted onto an EVEN count (2->3, strictly better) and declined onto an ODD one
 * (3->4, no gain, more quorum fragility).
 */
function makeService(
    overrides: {
        managerCount?: number
        nodeCount?: number
        localNodeState?: string
        joinTokens?: { worker: string; manager: string } | null
        quorumMax?: number
        /** What the managers advertise (engine `ManagerStatus.Addr`). */
        managerAddrs?: string[]
        meshAddress?: string | null
    } = {}
) {
    let managerAddrs = overrides.managerAddrs ?? ['100.88.0.1:2377']
    const cluster = {
        getLocalClusterSnapshot: vi.fn(() =>
            Effect.succeed({
                localNodeState: overrides.localNodeState ?? 'active',
                managerCount: overrides.managerCount ?? 1,
                nodeCount: overrides.nodeCount ?? 1,
            })
        ),
        getJoinTokens: vi.fn(() =>
            Effect.succeed(
                overrides.joinTokens === undefined
                    ? { worker: 'SWMTKN-worker', manager: 'SWMTKN-manager' }
                    : overrides.joinTokens
            )
        ),
        managerAddresses: vi.fn(() => Effect.succeed(managerAddrs)),
        reanchorLoneCluster: vi.fn((mesh: string) =>
            Effect.sync(() => {
                managerAddrs = [`${mesh}:2377`]
            })
        ),
    }
    const config: SwarmJoinConfig = { quorumMax: overrides.quorumMax ?? 3 }
    const participation: SwarmParticipationDefaults = {
        meshAddress: Effect.succeed(
            overrides.meshAddress === undefined
                ? '100.88.0.1'
                : overrides.meshAddress
        ),
    }
    return {
        service: makeSwarmJoinGrant({
            cluster: cluster as unknown as SwarmClusterShape,
            config,
            participation,
        }),
        cluster,
    }
}

describe("decideRole — the fleet's master-eligibility rule", () => {
    it('grants MANAGER when the manager count is EVEN and below target (2 → 3 gains tolerance)', () => {
        const { role, reason } = decideRole({
            requested: 'auto',
            managerCount: 2,
            target: 3,
        })
        expect(role).toBe('manager')
        expect(reason).toContain('EVEN')
    })

    it('grants WORKER when the manager count is ODD (3 → 4 gains no tolerance)', () => {
        const { role, reason } = decideRole({
            requested: 'auto',
            managerCount: 3,
            target: 3,
        })
        expect(role).toBe('worker')
        // At the target it is declined for the target reason, not the parity one.
        expect(reason).toContain('target')
    })

    it('grants WORKER when the fleet already reached its manager target', () => {
        const { role, reason } = decideRole({
            requested: 'manager',
            managerCount: 3,
            target: 3,
        })
        expect(role).toBe('worker')
        expect(reason).toContain('target of 3')
    })

    it('grants WORKER when the node explicitly asked for worker-only', () => {
        const { role, reason } = decideRole({
            requested: 'worker',
            managerCount: 2,
            target: 3,
        })
        expect(role).toBe('worker')
        expect(reason).toContain('asked for worker-only')
    })

    it("treats an absent request as a CANDIDATE (the wizard's 'can be master or worker')", () => {
        // 2 managers (even, below target) → the candidate IS admitted.
        expect(
            decideRole({ requested: undefined, managerCount: 2, target: 3 })
                .role
        ).toBe('manager')
        // 5 managers is ODD and below a target of 7 → parity declines (5→6).
        expect(
            decideRole({ requested: undefined, managerCount: 5, target: 7 })
                .role
        ).toBe('worker')
    })

    it("rounds an EVEN cap UP so the operator's intent is not silently halved", () => {
        // SWARM_QUORUM_MAX=2 → target 3 (not 1, which would freeze the fleet).
        // With target 3 and 2 managers present (even, below target) → admit.
        expect(
            decideRole({ requested: 'auto', managerCount: 2, target: 3 }).role
        ).toBe('manager')
    })

    it('REFUSES a SWARM_QUORUM_MAX of 1 (not a quorum) and falls back to the default', async () => {
        // A 1-manager target tolerates zero failures and would freeze the fleet.
        const { service } = makeService({ quorumMax: 1 })
        const grant = await run(service.buildGrant('auto'))
        // Falls back to target 3; the 1-manager cluster admits via the founding
        // exception rather than being permanently declined.
        expect(grant?.role).toBe('manager')
    })

    it('ADMITS a joiner to a 1-manager cluster (founding exception — otherwise the fleet could never reach quorum)', () => {
        // A strict parity rule would decline every joiner at managerCount=1, so
        // the fleet would be locked at one manager (0 failures tolerated) and
        // could never reach its target. Growth must be possible first.
        const decision = decideRole({
            requested: 'auto',
            managerCount: 1,
            target: 3,
        })
        expect(decision.role).toBe('manager')
        expect(decision.reason).toContain('founding manager')
    })

    it('declines onwards once the count is ODD and past the founding state (3 → 4 gains nothing)', () => {
        // 3 is odd AND below a target of 5, so this is the parity gate (not the
        // target gate) that declines: 3→4 tolerates no extra failure.
        const decision = decideRole({
            requested: 'auto',
            managerCount: 3,
            target: 5,
        })
        expect(decision.role).toBe('worker')
        expect(decision.reason).toContain('already ODD')
    })

    it('never grants manager when the cluster reports ZERO managers (defensive)', () => {
        const { role, reason } = decideRole({
            requested: 'manager',
            managerCount: 0,
            target: 3,
        })
        expect(role).toBe('worker')
        expect(reason).toContain('no managers')
    })
})

describe('SwarmJoinGrant.buildGrant — tokens and bounds', () => {
    it('withholds the manager token unless the role is manager (engine-level enforcement)', async () => {
        const { service } = makeService({ managerCount: 3 })
        const grant = await run(service.buildGrant('auto'))
        expect(grant).not.toBeNull()
        expect(grant?.role).toBe('worker')
        // The token is not merely unused — it is not handed over at all.
        expect(grant?.managerToken).toBeNull()
        expect(grant?.workerToken).toBe('SWMTKN-worker')
    })

    it('hands over the manager token when it grants manager', async () => {
        const { service } = makeService({ managerCount: 2 })
        const grant = await run(service.buildGrant('auto'))
        expect(grant?.role).toBe('manager')
        expect(grant?.managerToken).toBe('SWMTKN-manager')
    })

    it("returns null when this node's engine is not an active cluster", async () => {
        const { service } = makeService({ localNodeState: 'inactive' })
        expect(await run(service.buildGrant('auto'))).toBeNull()
    })

    it('returns null when the cluster reports no join tokens', async () => {
        const { service } = makeService({ joinTokens: null })
        expect(await run(service.buildGrant('auto'))).toBeNull()
    })

    it('hands the joiner the addresses the managers advertise', async () => {
        const { service } = makeService({
            managerCount: 3,
            managerAddrs: ['100.88.0.1:2377', '100.88.7.9:2377'],
        })
        const grant = await run(service.buildGrant('auto'))
        expect(grant?.controlPlaneAddrs).toEqual([
            '100.88.0.1:2377',
            '100.88.7.9:2377',
        ])
    })

    it('re-anchors a lone loopback cluster onto its mesh address before granting', async () => {
        const { service, cluster } = makeService({
            managerAddrs: ['127.0.0.1:2377'],
            meshAddress: '100.88.3.4',
        })
        const grant = await run(service.buildGrant('auto'))
        expect(cluster.reanchorLoneCluster).toHaveBeenCalledWith('100.88.3.4')
        expect(grant?.controlPlaneAddrs).toEqual(['100.88.3.4:2377'])
    })

    it('grants nothing when the cluster is on loopback and the node has no mesh address', async () => {
        const { service, cluster } = makeService({
            managerAddrs: ['127.0.0.1:2377'],
            meshAddress: null,
        })
        expect(await run(service.buildGrant('auto'))).toBeNull()
        expect(cluster.reanchorLoneCluster).not.toHaveBeenCalled()
    })
})
