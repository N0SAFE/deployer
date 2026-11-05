import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeshSwarmJoinGrant } from '@deployer/contracts-entities'
import { runPromiseUnwrapped } from '@deployer/effect-core'
import type { NodeDoorClient } from '@deployer/mesh-client'
import type { NodeConfigRepositoryShape } from '@deployer/node-state'
import type { SwarmBootstrapShape, SwarmClusterShape } from '@deployer/swarm'

import { DEPLOYER_VERSION } from '../../../utils/deployer-version'

import { makeRemoteInitializationService } from './remote-initialization.service'
import { SetupStepTracker } from './setup-step-tracker'

import type { EnvService } from '../../../../config/env/env.module'
import type { ClientContext, ClientLink } from '@orpc/client'

/**
 * The service link is the one thing that would need a real mesh: it is how a node that is not in the fleet yet
 * reaches the fleet's `enrollment` service. It is replaced by a link into an in-memory FLEET NODE below; everything
 * else in `RemoteInitializationService` runs for real.
 */
const fleetLink = vi.hoisted(() => ({
    current: undefined as undefined | ClientLink<ClientContext>,
}))
vi.mock('@deployer/mesh-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deployer/mesh-client')>()),
    serviceLink: () => fleetLink.current,
}))

/**
 * TWO NODES, ONE TIMELINE.
 *
 * - the FLEET node: owns the swarm, issues join tokens, answers `describe` / `enroll` over the mesh.
 * - the JOINER node: this node's agent (its door), its `node_config`, its swarm engine, and the real join flow.
 *
 * Every side effect on either node appends to `timeline`, so a test can assert the ORDER across the two machines
 * ("the joiner persisted `setup_done` only after the fleet enrolled it; the swarm join came after both").
 */
type Timeline = string[]

const DB_URL = 'postgresql://fleet:secret@fleet-db:5432/deployer'
const FLEET_SECRET = 'fleet-platform-secret-from-first-boot'

function makeFleet(
    timeline: Timeline,
    options: {
        version?: string
        grant?: MeshSwarmJoinGrant | null
        discoveryAfter?: number
        refuseEnroll?: boolean
    } = {}
) {
    const issued = new Set<string>()
    const enrolled = new Map<
        string,
        {
            nodeId: string
            serverUrl: string
            token: string
            requestedSwarmPolicy?: string
        }
    >()
    let calls = 0
    const grant: MeshSwarmJoinGrant | null =
        options.grant === undefined
            ? {
                  managerToken: null,
                  workerToken: 'SWMTKN-worker',
                  controlPlaneAddrs: ['10.77.0.1:2377'],
                  role: 'worker',
                  reason: 'fleet has a master',
              }
            : options.grant

    const link: ClientLink<ClientContext> = {
        call: (path, body) => {
            const op = path.join('.')
            calls += 1
            // The agent has not learned where the fleet is yet: the code the joiner retries on.
            if (calls <= (options.discoveryAfter ?? 0))
                return Promise.reject(
                    Object.assign(new Error('no replica'), {
                        code: 'NOT_FOUND',
                    })
                )
            const input = body as {
                token: string
                nodeId?: string
                serverUrl?: string
                requestedSwarmPolicy?: string
            }
            if (!issued.has(input.token))
                return Promise.reject(
                    Object.assign(new Error('bad token'), { code: 'FORBIDDEN' })
                )
            if (op === 'describe') {
                timeline.push('fleet:describe')
                return Promise.resolve({
                    version: options.version ?? DEPLOYER_VERSION,
                    meshNetwork: null,
                })
            }
            if (op === 'enroll') {
                if (options.refuseEnroll === true)
                    return Promise.reject(
                        Object.assign(new Error('fleet full'), {
                            code: 'FORBIDDEN',
                        })
                    )
                timeline.push('fleet:enroll')
                enrolled.set(input.nodeId ?? '', {
                    nodeId: input.nodeId ?? '',
                    serverUrl: input.serverUrl ?? '',
                    token: input.token,
                    requestedSwarmPolicy: input.requestedSwarmPolicy,
                })
                return Promise.resolve({
                    nodeId: input.nodeId,
                    enrolledAt: new Date().toISOString(),
                    databaseUrl: DB_URL,
                    platformSecret: FLEET_SECRET,
                    swarmGrant: grant,
                    meshJoinToken: input.token,
                })
            }
            return Promise.reject(new Error(`unexpected fleet call ${op}`))
        },
    }
    return {
        link,
        enrolled,
        issueToken: () => {
            const token = `join-${String(issued.size + 1)}`
            issued.add(token)
            return token
        },
        isValid: (token: string) => issued.has(token),
        calls: () => calls,
    }
}

function makeJoiner(
    timeline: Timeline,
    fleet: ReturnType<typeof makeFleet>,
    options: {
        nodeId?: string
        linkUp?: boolean
        viewMissing?: boolean
        convergeFails?: boolean
        snapshotState?: string
    } = {}
) {
    const nodeId = options.nodeId ?? 'joiner-node-1'
    const persisted: unknown[] = []
    const door = {
        joinWithToken: (token: string) => {
            // The agent only joins a swarm whose fleet actually issued the token — otherwise it answers nothing.
            if (!fleet.isValid(token)) return Promise.resolve(null)
            timeline.push('joiner:agent-joined')
            return Promise.resolve({
                learned: true,
                agents: [
                    { nodeId: 'fleet-1', address: 'ws://fleet-1/mesh/ws' },
                ],
            })
        },
        view: () =>
            Promise.resolve(
                options.viewMissing === true
                    ? null
                    : { self: { nodeId }, agents: [] }
            ),
        status: () =>
            Promise.resolve({
                interfaceUp: options.linkUp ?? true,
                peers: [{ latestHandshakeAt: 1 }],
            }),
    } as unknown as NodeDoorClient

    const repository = {
        upsert: (row: unknown) => {
            timeline.push('joiner:persist-node-config')
            persisted.push(row)
            return Effect.succeed(row)
        },
    } as unknown as NodeConfigRepositoryShape
    const swarmBootstrap = {
        converge: () => {
            timeline.push('joiner:swarm-join')
            return options.convergeFails === true
                ? Effect.fail(new Error('swarm join refused'))
                : Effect.succeed(undefined)
        },
    } as unknown as SwarmBootstrapShape
    const swarmCluster = {
        getLocalClusterSnapshot: () =>
            Effect.succeed({
                localNodeState: options.snapshotState ?? 'active',
                localNode: { swarmRole: 'worker' },
                master: { nodeId: 'fleet-1' },
                nodeCount: 2,
                managerCount: 1,
            }),
    } as unknown as SwarmClusterShape
    const env = {
        get: (key: string) =>
            key === 'APP_URL' ? 'https://joiner.example.com' : undefined,
    } as unknown as EnvService

    const shape = makeRemoteInitializationService({
        nodeConfigRepository: repository,
        envService: env,
        swarmBootstrap,
        swarmCluster,
        nodeDoor: () => door,
        // Non-undefined so the fleet is "reachable"; the mocked `serviceLink` ignores it and routes to the fleet node.
        agentLink: () => ({
            call: () =>
                Promise.reject(new Error('agent link is not used directly')),
        }),
    })
    /** The flow is an Effect failing with a tagged refusal; the matrix asserts on the refusal's message, so run it unwrapped. */
    const service = {
        initialize: (...args: Parameters<typeof shape.initialize>) =>
            runPromiseUnwrapped(shape.initialize(...args)),
    }
    return { service, persisted, nodeId }
}

/** The ordered ids of the setup steps the operator would watch. */
function stepsOf(emit: ReturnType<typeof vi.fn>): string[] {
    return emit.mock.calls.flatMap(([event]) =>
        (event as { type: string }).type === 'step_detail'
            ? [(event as { stepId: string }).stepId]
            : []
    )
}

const input = (token: string) => ({
    strategy: 'remote' as const,
    token,
    meshJoinToken: token,
    serverUrl: 'https://joiner.example.com',
})

describe('a new node joining a fleet from its setup', () => {
    let timeline: Timeline

    beforeEach(() => {
        timeline = []
        fleetLink.current = undefined
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('redeems the token, finds the fleet, is enrolled by it, THEN persists setup_done, THEN joins the swarm', async () => {
        const fleet = makeFleet(timeline)
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)
        const emit = vi.fn()

        const result = await joiner.service.initialize(
            {
                ...input(fleet.issueToken()),
                swarm: { mode: 'join', policy: 'worker' },
            } as never,
            new SetupStepTracker(),
            emit
        )

        expect(result).toEqual({ nodeId: joiner.nodeId, databaseUrl: DB_URL })
        expect(stepsOf(emit)).toEqual([
            'agent_join',
            'mesh_handshake',
            'version_check',
            'register_node',
            'finalize',
        ])
        // Order across BOTH machines: the node is never "done" before the fleet has said yes, and never in the swarm before it is "done".
        expect(timeline).toEqual([
            'joiner:agent-joined',
            'fleet:describe',
            'fleet:enroll',
            'joiner:persist-node-config',
            'joiner:swarm-join',
        ])
        // The fleet knows exactly this node, under the id ITS agent reported (not one the wizard invented).
        expect(fleet.enrolled.get(joiner.nodeId)).toMatchObject({
            nodeId: joiner.nodeId,
            serverUrl: 'https://joiner.example.com/',
            requestedSwarmPolicy: 'worker',
        })
        // What the joiner stored is the FLEET's answer: its database, its role decision, its swarm token.
        expect(joiner.persisted).toHaveLength(1)
        expect(joiner.persisted[0]).toMatchObject({
            nodeId: joiner.nodeId,
            strategy: 'remote',
            setupState: 'setup_done',
            databaseUrl: DB_URL,
            // The fleet's secret, so this node verifies what the others sign.
            platformSecret: FLEET_SECRET,
            databaseProvisioning: 'external',
            swarmConfig: {
                mode: 'join',
                policy: 'worker',
                joinToken: 'SWMTKN-worker',
                joinAddrs: ['10.77.0.1:2377'],
            },
        })
    })

    it('keeps looking while the agent has not learned where the fleet is, then succeeds', async () => {
        vi.useFakeTimers()
        const fleet = makeFleet(timeline, { discoveryAfter: 3 })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)

        const done = joiner.service.initialize(
            input(fleet.issueToken()),
            new SetupStepTracker(),
            vi.fn()
        )
        await vi.advanceTimersByTimeAsync(10_000)

        await expect(done).resolves.toMatchObject({ databaseUrl: DB_URL })
        // Three discovery misses, then describe + enroll.
        expect(fleet.calls()).toBeGreaterThanOrEqual(5)
    })

    it('a token the fleet never issued: the agent refuses, the fleet is never contacted, nothing is persisted, the swarm is untouched', async () => {
        const fleet = makeFleet(timeline)
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)

        await expect(
            joiner.service.initialize(
                input('forged-token'),
                new SetupStepTracker(),
                vi.fn()
            )
        ).rejects.toThrow('no mesh agent')

        expect(timeline).toEqual([])
        expect(fleet.calls()).toBe(0)
        expect(joiner.persisted).toEqual([])
    })

    it('a fleet running a HIGHER version: the join stops at the version check, before enrollment and before anything is persisted', async () => {
        const fleet = makeFleet(timeline, { version: '999.0.0' })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)
        const emit = vi.fn()

        await expect(
            joiner.service.initialize(
                input(fleet.issueToken()),
                new SetupStepTracker(),
                emit
            )
        ).rejects.toThrow('Version mismatch')

        expect(stepsOf(emit)).toEqual([
            'agent_join',
            'mesh_handshake',
            'version_check',
        ])
        expect(timeline).not.toContain('fleet:enroll')
        expect(joiner.persisted).toEqual([])
        expect(timeline).not.toContain('joiner:swarm-join')
    })

    it('the fleet refuses to enroll the node: the node is NOT marked done and does not join the swarm', async () => {
        const fleet = makeFleet(timeline, { refuseEnroll: true })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)

        await expect(
            joiner.service.initialize(
                input(fleet.issueToken()),
                new SetupStepTracker(),
                vi.fn()
            )
        ).rejects.toThrow('fleet full')

        // A `setup_done` row here would make every later boot take the restart path against a fleet that never admitted this node.
        expect(joiner.persisted).toEqual([])
        expect(timeline).not.toContain('joiner:swarm-join')
    })

    it('a fleet with no swarm to hand over: the node is enrolled and done, and the swarm join is deferred (not attempted)', async () => {
        const fleet = makeFleet(timeline, { grant: null })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)

        await joiner.service.initialize(
            input(fleet.issueToken()),
            new SetupStepTracker(),
            vi.fn()
        )

        expect(timeline).toEqual([
            'joiner:agent-joined',
            'fleet:describe',
            'fleet:enroll',
            'joiner:persist-node-config',
        ])
        expect(
            (joiner.persisted[0] as { swarmConfig?: unknown }).swarmConfig
        ).toBeUndefined()
    })
})

/**
 * THE JOIN MATRIX: every fleet decision × every role the joiner can ask for, then a failure injected at each step.
 * Invariants: the node is `setup_done` only after the fleet enrolled it; the swarm join happens only after that and only
 * when the fleet offered a swarm; the stored role/token is exactly what the fleet granted, never what the node asked for.
 */
const grants: [string, MeshSwarmJoinGrant | null][] = [
    [
        'worker grant',
        {
            managerToken: null,
            workerToken: 'TOK-W',
            controlPlaneAddrs: ['10.77.0.1:2377'],
            role: 'worker',
            reason: 'r',
        },
    ],
    [
        'manager grant',
        {
            managerToken: 'TOK-M',
            workerToken: 'TOK-W',
            controlPlaneAddrs: ['10.77.0.1:2377', '10.77.0.2:2377'],
            role: 'manager',
            reason: 'r',
        },
    ],
    [
        'manager grant without a manager token',
        {
            managerToken: null,
            workerToken: 'TOK-W',
            controlPlaneAddrs: ['10.77.0.1:2377'],
            role: 'manager',
            reason: 'r',
        },
    ],
    ['no swarm offered', null],
]
const asked = ['auto', 'manager', 'worker', undefined] as const

describe.each(
    grants.flatMap(([gName, grant]) =>
        asked.map(
            (policy) =>
                [`${gName} · asked ${String(policy)}`, grant, policy] as const
        )
    )
)('join matrix · %s', (_name, grant, policy) => {
    it('stores exactly what the fleet granted, in the right order', async () => {
        const timeline: Timeline = []
        const fleet = makeFleet(timeline, { grant })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)

        await joiner.service.initialize(
            {
                ...input(fleet.issueToken()),
                swarm:
                    policy === undefined ? undefined : { mode: 'join', policy },
            } as never,
            new SetupStepTracker(),
            vi.fn()
        )

        // The role the node ASKED for is forwarded as a request only.
        expect(fleet.enrolled.get(joiner.nodeId)?.requestedSwarmPolicy).toBe(
            policy
        )
        const row = joiner.persisted[0] as {
            setupState: string
            databaseUrl: string
            swarmConfig?: {
                policy: string
                joinToken: string
                joinAddrs: string[]
            }
        }
        expect(row).toMatchObject({
            setupState: 'setup_done',
            databaseUrl: DB_URL,
        })
        if (grant === null) {
            expect(row.swarmConfig).toBeUndefined()
            expect(timeline).not.toContain('joiner:swarm-join')
        } else {
            expect(row.swarmConfig).toEqual({
                mode: 'join',
                policy: grant.role === 'manager' ? 'auto' : 'worker',
                advertiseAddr: null,
                joinToken:
                    grant.role === 'manager'
                        ? (grant.managerToken ?? grant.workerToken)
                        : grant.workerToken,
                joinAddrs: grant.controlPlaneAddrs,
            })
            expect(timeline.indexOf('joiner:persist-node-config')).toBeLessThan(
                timeline.indexOf('joiner:swarm-join')
            )
        }
    })
})

describe.each([
    ['equal', DEPLOYER_VERSION, true],
    ['fleet newer', '999.0.0', false],
    ['fleet older', '0.0.1', true],
] as const)('join matrix · versions · fleet %s', (_name, version, joins) => {
    it(joins ? 'joins' : 'refuses before enrolling', async () => {
        const timeline: Timeline = []
        const fleet = makeFleet(timeline, { version })
        fleetLink.current = fleet.link
        const joiner = makeJoiner(timeline, fleet)
        const run = joiner.service.initialize(
            input(fleet.issueToken()),
            new SetupStepTracker(),
            vi.fn()
        )

        if (joins) await expect(run).resolves.toBeDefined()
        else await expect(run).rejects.toThrow()
        expect(timeline.includes('fleet:enroll')).toBe(joins)
        expect(joiner.persisted.length).toBe(joins ? 1 : 0)
    })
})

describe.each([
    ['the agent never answers (no door)', { door: 'none' }, 'no mesh agent'],
    [
        'the agent reports no identity',
        { joiner: { viewMissing: true } },
        'did not report its identity',
    ],
    [
        'the fleet refuses the token',
        { fleet: { refuseEnroll: true } },
        'fleet full',
    ],
] as const)('join failure matrix · %s', (_name, injected, message) => {
    it('fails with a readable reason and leaves NO setup_done row', async () => {
        const timeline: Timeline = []
        const fleet = makeFleet(
            timeline,
            'fleet' in injected ? injected.fleet : {}
        )
        fleetLink.current = fleet.link
        const joiner = makeJoiner(
            timeline,
            fleet,
            'joiner' in injected ? injected.joiner : {}
        )
        const token = 'door' in injected ? 'not-issued' : fleet.issueToken()

        await expect(
            joiner.service.initialize(
                input(token),
                new SetupStepTracker(),
                vi.fn()
            )
        ).rejects.toThrow(message)

        expect(joiner.persisted).toEqual([])
        expect(timeline).not.toContain('joiner:swarm-join')
    })
})

describe('join failure after the fleet said yes', () => {
    it.each([
        ['the swarm join is refused', { convergeFails: true }],
        ['the engine ends up not active', { snapshotState: 'pending' }],
    ] as const)(
        '%s: the node row is already persisted (the restart path re-converges from it), and the run does not claim a joined swarm',
        async (_name, injected) => {
            const timeline: Timeline = []
            const fleet = makeFleet(timeline)
            fleetLink.current = fleet.link
            const joiner = makeJoiner(timeline, fleet, injected)
            const emit = vi.fn()

            const run = joiner.service.initialize(
                input(fleet.issueToken()),
                new SetupStepTracker(),
                emit
            )
            if ('convergeFails' in injected)
                await expect(run).rejects.toThrow('swarm join refused')
            else await expect(run).resolves.toBeDefined()

            expect(joiner.persisted).toHaveLength(1)
            const logs = JSON.stringify(emit.mock.calls)
            expect(logs).not.toContain('Joined the Swarm cluster')
        }
    )
})
