import { Effect } from 'effect'
import { firstValueFrom, of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import type { NodeConfigRow } from '@deployer/node-state'

import { makeClusterOrchestratorService } from '@/modules/cluster/services/cluster-orchestrator.service'
import type { SwarmBootstrapService } from '@/modules/cluster/services/swarm-bootstrap.service'
import { makeSetupPhase } from '@/modules/health/setup-phase.service'
import type { BootstrapIngressService } from '@/modules/ingress/services/bootstrap-ingress.service'
import { makeOrchestrationStreamService } from '@/modules/progress/services/orchestration-stream.service'
import type { NodeConfigStore } from '@/modules/wizard/node-config.port'
import { makeSetupGateService } from '@/modules/wizard/setup-gate.service'
import type { WizardStreamService } from '@/modules/wizard/wizard-stream.service'
import { makeEnvService } from '@/test-support/env'

import { makeHandoverOrchestratorService } from './services/handover-orchestrator.service'

import type { ApiReadinessWatcherService } from './services/api-readiness-watcher.service'
import type { ApiServiceProvisioner } from './services/api-service-provisioner.service'
import type { IngressHandoverService } from './services/ingress-handover.service'
import type {
    ClusterBootstrapResult,
    ClusterEntryMode,
} from '../cluster/cluster.types'

/**
 * A joining node's SETUP half, wired for real: gate → cluster pipeline → handover pipeline.
 *
 * What is real: `SetupGateService`, `SetupPhaseService`, `ClusterOrchestratorService`,
 * `HandoverOrchestratorService`, `OrchestrationStreamService` — i.e. every piece that DECIDES when something
 * starts. What is faked: the leaves that would touch the world (the swarm engine, the API container, Traefik),
 * each recording into ONE timeline. The assertions are about that timeline, because "the service starts when it is
 * needed and not before the decision" is a statement about ORDER and ABSENCE, which no per-class spec can make.
 *
 * The API half of the join (agent redeems the token, the fleet enrolls the node) is
 * `remote-join.integration.spec.ts` in `apps/api/shared`.
 */

const JOIN_PAYLOAD = {
    strategy: 'remote',
    token: 'platform-grant',
    meshJoinToken: 'agent-join-token',
    serverUrl: 'https://joiner.example.com',
} as const

function makeStore(initial: Partial<NodeConfigRow> | null = null) {
    let row: NodeConfigRow | null =
        initial === null ? null : ({ ...initial } as NodeConfigRow)
    const upsert = vi.fn((data: Parameters<NodeConfigStore['upsert']>[0]) => {
        row = { ...(row ?? ({} as NodeConfigRow)), ...data }
        return Effect.succeed(row)
    })
    const store: NodeConfigStore = { find: () => Effect.succeed(row), upsert }
    return Object.assign(store, { upsert, row: () => row })
}

function makeNode(options: {
    mode: 'prod' | 'dev'
    store?: ReturnType<typeof makeStore>
    cluster?: (mode: ClusterEntryMode) => ClusterBootstrapResult
    apiReady?: boolean
    /** Holds the engine mid-convergence until resolved. */
    engineHeld?: Promise<void>
    /** Extra env (e.g. a compose-managed database URL). */
    env?: Record<string, string>
    provisionThrows?: Error
    /** HTTP status the API answers the trigger with. */
    triggerStatus?: number
}) {
    const timeline: string[] = []
    const env = makeEnvService({ SETUP_MODE: options.mode, ...options.env })
    const phases = makeSetupPhase()
    const orchestration = makeOrchestrationStreamService(env)
    const store = options.store ?? makeStore(null)

    const swarm = {
        bootstrap: async (mode: ClusterEntryMode) => {
            timeline.push(`engine:${mode.kind}`)
            await options.engineHeld
            return (
                options.cluster ??
                (() => ({
                    ok: true as const,
                    nodeId: 'joiner',
                    swarmRole: 'manager' as const,
                    nodeCount: 1,
                    managerCount: 1,
                }))
            )(mode)
        },
    } as unknown as SwarmBootstrapService['Service']
    const cluster = makeClusterOrchestratorService(swarm, phases, orchestration)

    const gate = makeSetupGateService(
        phases,
        store,
        env,
        cluster,
        orchestration
    )

    const provisioner = {
        ensureApi: () => {
            if (options.provisionThrows !== undefined)
                return Promise.reject(options.provisionThrows)
            timeline.push('api:start')
            return Promise.resolve({
                kind: 'container' as const,
                url: 'http://bff:3005',
                detail: 'test',
            })
        },
    } as unknown as ApiServiceProvisioner['Service']
    const readiness = {
        waitUntilReady: () => {
            timeline.push('api:poll-ready')
            return of(
                options.apiReady === false
                    ? { ready: false as const, reason: '503' }
                    : { ready: true as const, reason: 'ready' }
            )
        },
    } as unknown as ApiReadinessWatcherService['Service']
    const ingress = {
        pointApiAt: (url: string) => (
            timeline.push(`ingress:api->${url}`),
            Promise.resolve()
        ),
        pointSetupAtDonePage: () => (
            timeline.push('ingress:setup-done-page'),
            Promise.resolve()
        ),
        webHostname: () => 'web.deployer.localhost',
        apiHostname: () => 'api.deployer.localhost',
    } as unknown as IngressHandoverService['Service']
    const bootstrapIngress = {
        releaseEntryPort: () => Promise.resolve(true),
        waitForEntryPointToServe: () => Promise.resolve(true),
    } as unknown as BootstrapIngressService['Service']
    const stream = {
        attachWhenReachable: () => Promise.resolve(),
    } as unknown as WizardStreamService['Service']

    const handover = makeHandoverOrchestratorService(
        provisioner,
        readiness,
        ingress,
        phases,
        gate,
        bootstrapIngress,
        orchestration,
        stream,
        env
    )
    handover.triggerTransport = ((
        _url: string | URL | Request,
        init?: RequestInit
    ) => {
        timeline.push(
            `api:trigger ${typeof init?.body === 'string' ? init.body : ''}`
        )
        return Promise.resolve(
            new Response('{}', { status: options.triggerStatus ?? 201 })
        )
    }) as typeof fetch

    /** What the app does at boot: the gate reads the persisted row, the handover subscribes to the gate edge. */
    const boot = () => {
        Effect.runSync(gate.onModuleInit())
        Effect.runSync(handover.onModuleInit())
    }

    return {
        timeline,
        phases,
        gate,
        handover,
        store,
        boot,
        result: () => firstValueFrom(handover.stream$),
    }
}

/** Everything that means "a platform service exists / is being asked to start". */
const STARTS = (line: string) =>
    line.startsWith('engine:') ||
    line.startsWith('api:') ||
    line.startsWith('ingress:')

describe("a joining node's setup: nothing starts before the decision", () => {
    it('fresh boot: the wizard is up, the gate is shut, and the engine, API and ingress are all untouched', () => {
        const node = makeNode({ mode: 'prod' })
        node.boot()

        expect(node.phases.current().phase).toBe('collecting')
        // `/setup/health` is what compose (dev) and the scheduler (prod) read to start the API: it must say no.
        expect(node.phases.isReady()).toBe(false)
        expect(node.timeline.filter(STARTS)).toEqual([])
        // Nothing is persisted either: the decision has not been made, so there is nothing for the API to read.
        expect(node.store.upsert).not.toHaveBeenCalled()
    })

    it('stays untouched while the operator only INSPECTS the mesh (no trigger => no start)', async () => {
        const node = makeNode({ mode: 'prod' })
        node.boot()
        // Let any stray microtask-scheduled work run before asserting absence.
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(node.timeline).toEqual([])
        expect(node.phases.isReady()).toBe(false)
    })
})

describe("a joining node's setup: after the decision, services start in dependency order", () => {
    it('prod: engine first, THEN the gate opens, THEN the API, THEN the trigger carrying the join choices, THEN ready', async () => {
        const node = makeNode({ mode: 'prod' })
        node.boot()
        const done = node.result()

        await node.gate.open(JOIN_PAYLOAD)
        const result = await done

        expect(result.ok).toBe(true)
        // The order IS the contract (swarm exists → API scheduled onto it → trigger delivered → ingress swapped).
        expect(node.timeline.map((line) => line.split(' ')[0])).toEqual([
            'engine:found', // a remote joiner carries no SWMTKN yet: the lone cluster is left later by the API's converge
            'api:start',
            'ingress:api->http://bff:3005',
            'api:trigger',
            'api:poll-ready',
            'ingress:setup-done-page',
        ])
        // The trigger is the joiner's decision, verbatim: the API's RemoteInitializationService reads the token from it.
        const trigger = node.timeline.find((line) =>
            line.startsWith('api:trigger')
        )
        expect(trigger).toContain('agent-join-token')
        expect(node.phases.current().phase).toBe('ready')
    })

    it('prod: the decision is persisted BEFORE the engine is asked to do anything', async () => {
        const node = makeNode({ mode: 'prod' })
        node.boot()
        let persistedWhenEngineStarted = false
        node.store.upsert.mockImplementationOnce((data) => {
            persistedWhenEngineStarted = !node.timeline.some((line) =>
                line.startsWith('engine:')
            )
            return Effect.succeed(data as NodeConfigRow)
        })

        await node.gate.open(JOIN_PAYLOAD)

        expect(persistedWhenEngineStarted).toBe(true)
    })

    it('prod: the gate stays SHUT while the swarm is still converging, and the API has not been asked for', async () => {
        let release: () => void = () => undefined
        const engineHeld = new Promise<void>((resolve) => (release = resolve))
        const node = makeNode({ mode: 'prod', engineHeld })
        node.boot()

        await node.gate.open(JOIN_PAYLOAD)
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(node.phases.current().phase).toBe('clustering')
        expect(node.phases.isReady()).toBe(false)
        expect(node.timeline).not.toContain('api:start')

        release()
        await node.result()
        expect(node.timeline).toContain('api:start')
    })

    it('prod: a failed engine bootstrap never starts the API, and the gate stays shut', async () => {
        const node = makeNode({
            mode: 'prod',
            cluster: () => ({ ok: false, reason: 'cannot reach the fleet' }),
        })
        node.boot()

        await node.gate.open(JOIN_PAYLOAD)
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(node.phases.current().phase).toBe('failed')
        expect(node.phases.isReady()).toBe(false)
        expect(
            node.timeline.filter(
                (line) => line.startsWith('api:') || line.startsWith('ingress:')
            )
        ).toEqual([])
    })

    it('dev: no engine call at all; the gate opens at once and the API is what comes next', async () => {
        const node = makeNode({ mode: 'dev' })
        node.boot()
        const done = node.result()

        await node.gate.open(JOIN_PAYLOAD)
        await done

        expect(node.timeline.some((line) => line.startsWith('engine:'))).toBe(
            false
        )
        expect(node.timeline[0]).toBe('api:start')
    })

    it('a second open() is a no-op: the join is not re-triggered', async () => {
        const node = makeNode({ mode: 'prod' })
        node.boot()
        const done = node.result()

        await node.gate.open(JOIN_PAYLOAD)
        await done
        const before = node.timeline.length
        await node.gate.open(JOIN_PAYLOAD)

        expect(node.timeline).toHaveLength(before)
    })
})

describe('a node that already joined (restart)', () => {
    it('opens the gate at boot with NO wizard and delivers NO trigger', async () => {
        const store = makeStore({
            nodeId: 'n1',
            strategy: 'remote',
            setupState: 'setup_done',
            meshUrlsSnapshot: [],
        })
        const node = makeNode({ mode: 'prod', store })
        const done = node.result()

        node.boot()
        await done

        expect(
            node.timeline.some((line) => line.startsWith('api:trigger'))
        ).toBe(false)
        expect(node.timeline).toContain('api:start')
        // The persisted row is the decision: it is not rewritten by a restart.
        expect(store.upsert).not.toHaveBeenCalled()
    })
})

/**
 * THE CONFIGURATION MATRIX.
 *
 * Every combination an operator can reach: profile × strategy × role × database source × (swarm token present or not),
 * and for each one the same invariants. A new option that is not in the matrix is a hole; a combination that breaks an
 * invariant fails here, by name, instead of on a production node.
 *
 * `managedWeb` is not in the matrix on purpose: it adds a real HTTP readiness probe, covered by
 * `handover-orchestrator.service.spec.ts`.
 */
type Case = {
    name: string
    payload: unknown
    env?: Record<string, string>
    engine: 'found' | 'join'
    provisioning: 'local' | 'external'
}
const URL_EXT = 'postgresql://u:p@db.example.com:5432/deployer'
const PAYLOADS: Case[] = [
    {
        name: 'local, mixed manager, provisioned db',
        payload: {
            strategy: 'local',
            swarm: { mode: 'create', policy: 'auto' },
        },
        engine: 'found',
        provisioning: 'local',
    },
    {
        name: 'local, dedicated master, provisioned db',
        payload: {
            strategy: 'local',
            swarm: { mode: 'create', policy: 'manager' },
        },
        engine: 'found',
        provisioning: 'local',
    },
    {
        name: 'local, existing db url',
        payload: { strategy: 'local', existingDatabaseUrl: URL_EXT },
        engine: 'found',
        provisioning: 'external',
    },
    {
        name: 'local, compose-managed db',
        payload: { strategy: 'local' },
        env: {
            MANAGED_GLOBAL_DB_URL: 'postgresql://m:m@global-db:5432/deployer',
        },
        engine: 'found',
        provisioning: 'external',
    },
    {
        name: 'local, no payload at all',
        payload: undefined,
        engine: 'found',
        provisioning: 'local',
    },
    {
        name: 'remote, agent token only (no swarm token)',
        payload: JOIN_PAYLOAD,
        engine: 'found',
        provisioning: 'local',
    },
    {
        name: 'remote, swarm token and addresses',
        payload: {
            ...JOIN_PAYLOAD,
            swarm: {
                policy: 'worker',
                joinToken: 'SWMTKN-1-x',
                joinAddrs: ['10.0.0.1:2377'],
            },
        },
        engine: 'join',
        provisioning: 'local',
    },
    {
        name: 'remote, swarm token without addresses',
        payload: {
            ...JOIN_PAYLOAD,
            swarm: { policy: 'worker', joinToken: 'SWMTKN-1-x' },
        },
        engine: 'found',
        provisioning: 'local',
    },
    {
        name: 'remote, addresses without swarm token',
        payload: {
            ...JOIN_PAYLOAD,
            swarm: { policy: 'worker', joinAddrs: ['10.0.0.1:2377'] },
        },
        engine: 'found',
        provisioning: 'local',
    },
]
const MODES = ['dev', 'prod'] as const
const combos = MODES.flatMap((mode) =>
    PAYLOADS.map((c) => [`${mode}: ${c.name}`, mode, c] as const)
)

describe.each(combos)('matrix · %s', (_name, mode, c) => {
    it('success: gate shut until the decision, engine only in prod, strict start order, decision delivered verbatim', async () => {
        const node = makeNode({ mode, env: c.env })
        node.boot()
        expect(node.phases.isReady()).toBe(false)
        expect(node.timeline).toEqual([])

        const done = node.result()
        await node.gate.open(c.payload)
        const result = await done

        expect(result.ok).toBe(true)
        expect(node.phases.current().phase).toBe('ready')
        const lines = node.timeline.map((line) => line.split(' ')[0])
        expect(lines).toEqual([
            ...(mode === 'prod' ? [`engine:${c.engine}`] : []),
            'api:start',
            expect.stringMatching(/^ingress:api->/),
            'api:trigger',
            'api:poll-ready',
            'ingress:setup-done-page',
        ])
        const trigger = node.timeline
            .find((line) => line.startsWith('api:trigger'))!
            .slice('api:trigger '.length)
        if (c.payload === undefined) expect(trigger).toBe('')
        else expect(JSON.parse(trigger)).toEqual(c.payload)
        expect(node.store.row()?.databaseProvisioning).toBe(c.provisioning)
    })

    it('the swarm is never asked to do anything in dev, and always before the API in prod', async () => {
        const node = makeNode({ mode, env: c.env })
        node.boot()
        const done = node.result()
        await node.gate.open(c.payload)
        await done

        const engine = node.timeline.findIndex((line) =>
            line.startsWith('engine:')
        )
        if (mode === 'dev') expect(engine).toBe(-1)
        else expect(engine).toBeLessThan(node.timeline.indexOf('api:start'))
    })

    it('API never becomes ready: setup ends FAILED, gate closed, no ingress swap, nothing published as ready', async () => {
        const node = makeNode({ mode, env: c.env, apiReady: false })
        node.boot()
        const done = node.result()
        await node.gate.open(c.payload)
        const result = await done

        expect(result.ok).toBe(false)
        expect(node.phases.current().phase).toBe('failed')
        expect(node.phases.isReady()).toBe(false)
        expect(node.timeline).not.toContain('ingress:setup-done-page')
    })

    it('API refuses the trigger (HTTP 422): FAILED, never polled for readiness', async () => {
        const node = makeNode({ mode, env: c.env, triggerStatus: 422 })
        node.boot()
        const done = node.result()
        await node.gate.open(c.payload)
        const result = await done

        expect(result.ok).toBe(false)
        expect(node.phases.current().phase).toBe('failed')
        expect(node.timeline).not.toContain('api:poll-ready')
        expect(node.timeline).not.toContain('ingress:setup-done-page')
    })

    it('the API cannot be scheduled: FAILED with the reason, retryable, no trigger sent', async () => {
        const node = makeNode({
            mode,
            env: c.env,
            provisionThrows: new Error(
                'SETUP_MODE=prod requires DEPLOYER_BFF_IMAGE'
            ),
        })
        node.boot()
        const done = node.result()
        await node.gate.open(c.payload)
        const result = await done

        expect(result).toMatchObject({
            ok: false,
            reason: expect.stringContaining('DEPLOYER_BFF_IMAGE'),
        })
        expect(node.phases.current().phase).toBe('failed')
        expect(
            node.timeline.some((line) => line.startsWith('api:trigger'))
        ).toBe(false)
    })
})

describe.each(PAYLOADS.map((c) => [c.name, c] as const))(
    'matrix (prod only) · engine failure · %s',
    (_name, c) => {
        it('a failed cluster bootstrap closes the gate and starts neither API nor ingress', async () => {
            const node = makeNode({
                mode: 'prod',
                env: c.env,
                cluster: () => ({ ok: false, reason: 'engine said no' }),
            })
            node.boot()
            await node.gate.open(c.payload)
            await new Promise((resolve) => setTimeout(resolve, 20))

            expect(node.phases.current().phase).toBe('failed')
            expect(node.phases.isReady()).toBe(false)
            expect(
                node.timeline.filter(
                    (line) =>
                        line.startsWith('api:') || line.startsWith('ingress:')
                )
            ).toEqual([])
        })
    }
)

describe('restart matrix: a node that finished setup never re-decides', () => {
    it.each(MODES)(
        '%s: boots straight to the handover, persisted row untouched, no trigger',
        async (mode) => {
            const store = makeStore({
                nodeId: 'n1',
                strategy: 'remote',
                setupState: 'setup_done',
                meshUrlsSnapshot: [],
            })
            const node = makeNode({ mode, store })
            const done = node.result()
            node.boot()
            await done

            expect(store.upsert).not.toHaveBeenCalled()
            expect(
                node.timeline.some((line) => line.startsWith('api:trigger'))
            ).toBe(false)
            expect(node.phases.current().phase).toBe('ready')
        }
    )

    it.each([['not_started'], ['in_progress']])(
        'a row in state %s is NOT a finished setup: the wizard is shown and nothing starts',
        (setupState) => {
            const node = makeNode({
                mode: 'prod',
                store: makeStore({
                    nodeId: 'n1',
                    strategy: 'local',
                    setupState,
                    meshUrlsSnapshot: [],
                } as Partial<NodeConfigRow>),
            })
            node.boot()

            expect(node.phases.current().phase).toBe('collecting')
            expect(node.timeline).toEqual([])
        }
    )
})
