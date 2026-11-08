import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerNotFound } from '@deployer/docker'
import type { DockerEngineShape } from '@deployer/docker'
import type { NodeConfigRepositoryShape } from '@deployer/node-state'
import { SupervisorOrchestrator } from '@deployer/supervision'

import { makeNodeConfigSnapshot } from '../../node-state/node-config.snapshot'
import { harness, testBus } from '../supervisor-test-harness'

import {
    GLOBAL_DB_SUPERVISOR_ID,
    makeGlobalDbRegistration,
} from './global-db.supervisor'

import type { EnvService } from '../../../../config/env/env.module'

type Service = {
    ID: string
    CreatedAt: string
    UpdatedAt: string
    Spec: { Name: string }
}

/** An engine inspect: the value, or the typed not-found the real engine raises for a 404. */
const orNotFound = <A>(value: A | null, resource: string) =>
    value === null
        ? Effect.fail(new DockerNotFound({ resource }))
        : Effect.succeed(value)

function makeMocks(provisioning: 'local' | 'external' | null = 'local') {
    // Port 1 is never open: the "unreachable" probe test must not depend on the host's 5432 being
    // free (the managed Postgres container publishes exactly that port).
    const nodeConfigRepository = {
        find: vi.fn(() =>
            provisioning === null
                ? Effect.succeed(null)
                : Effect.succeed({
                      nodeId: 'n1',
                      strategy: 'local',
                      setupState: 'setup_done',
                      databaseUrl:
                          'postgres://deployer:deployer@127.0.0.1:1/deployer',
                      databaseProvisioning: provisioning,
                      configuredAt: '2026-01-01T00:00:00.000Z',
                  })
        ),
    } as unknown as NodeConfigRepositoryShape

    let service: Service | null = null
    let tasks: { Status: { State: string } }[] = [
        { Status: { State: 'running' } },
    ]
    const inspectVolume = vi.fn(() => ({
        Name: 'deployer_postgres_data',
        Mountpoint: '/var/lib/docker/volumes/deployer_postgres_data/_data',
        UsageData: { Size: 4_567_890, RefCount: 1 },
    }))
    const reconcile = vi.fn((spec: { name: string }) =>
        Effect.sync(() => {
            service = {
                ID: 'svc-1',
                CreatedAt: '',
                UpdatedAt: '',
                Spec: { Name: spec.name },
            }
        })
    )

    const engine = {
        swarmCluster: { isActive: () => Effect.succeed(true) },
        containers: { removeIfExists: () => Effect.void },
        networks: { ensureOverlay: () => Effect.void },
        volumes: { inspect: () => orNotFound(inspectVolume(), 'volume') },
        swarmServices: {
            reconcile,
            inspect: () => orNotFound(service, 'service'),
            listTasks: () => Effect.succeed(tasks),
        },
    }
    const dockerService = engine as unknown as DockerEngineShape

    return {
        nodeConfigRepository,
        dockerService,
        inspectVolume,
        reconcile,
        /** Pretend the service already exists (so process info and probes see it without a convergence). */
        seedService: () => {
            service = {
                ID: 'svc-1',
                CreatedAt: '',
                UpdatedAt: '',
                Spec: { Name: 'deployer-postgres' },
            }
        },
        removeService: () => {
            service = null
        },
        setTasks: (next: { Status: { State: string } }[]) => {
            tasks = next
        },
    }
}

async function makeSupervisor(mocks: ReturnType<typeof makeMocks>) {
    const env = {
        get: vi.fn(
            (key: string) =>
                ({ MANAGED_GLOBAL_DB_ENABLED: false })[
                    key as 'MANAGED_GLOBAL_DB_ENABLED'
                ]
        ),
    } as unknown as EnvService
    const snapshot = makeNodeConfigSnapshot(mocks.nodeConfigRepository)
    // The app primes the cache in `onModuleInit`, before any registration activates.
    await Effect.runPromise(snapshot.refresh())
    return harness(
        makeGlobalDbRegistration({
            engine: mocks.dockerService,
            snapshot,
            env,
            bus: testBus(),
        })
    )
}

describe('global-db supervisor — conditional registration', () => {
    it('registers into the orchestrator when the database is LOCALLY managed', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)
        const orchestrator = new SupervisorOrchestrator.live()

        await supervisor.register(orchestrator)

        expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(true)
        expect(orchestrator.list().map((s) => s.id)).toContain(
            GLOBAL_DB_SUPERVISOR_ID
        )
    })

    it('does NOT register when the database is externally managed', async () => {
        const mocks = makeMocks('external')
        const supervisor = await makeSupervisor(mocks)
        const orchestrator = new SupervisorOrchestrator.live()

        await supervisor.register(orchestrator)

        expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(false)
    })

    it('does NOT register when provisioning is unknown (legacy config)', async () => {
        const mocks = makeMocks(null)
        const supervisor = await makeSupervisor(mocks)
        const orchestrator = new SupervisorOrchestrator.live()

        await supervisor.register(orchestrator)

        expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(false)
    })
})

describe('global-db supervisor — reconcile', () => {
    it('ensures the swarm service runs for a locally-managed database', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)

        const state = await supervisor.ensureDesiredState()

        expect(state).toBe('converged')
        expect(mocks.reconcile).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'deployer-postgres' })
        )
    })

    it('does NOT touch the container for an external database', async () => {
        const mocks = makeMocks('external')
        const supervisor = await makeSupervisor(mocks)

        const state = await supervisor.ensureDesiredState()

        expect(state).toBe('converged')
        expect(mocks.reconcile).not.toHaveBeenCalled()
    })
})

describe('global-db supervisor — probe / health', () => {
    it('reports healthy with rich measurements for a managed (local) database', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)
        await supervisor.ensureDesiredState()

        const health = await supervisor.getHealth()

        expect(health.supervisorId).toBe(GLOBAL_DB_SUPERVISOR_ID)
        expect(health.healthy).toBe(true)
        expect(health.detail).toContain('running')
        // Discriminated union resolves to the "managed" branch.
        expect(health.payload.mode).toBe('managed')
        if (health.payload.mode === 'managed') {
            expect(health.payload.service).not.toBeNull()
            expect(health.payload.service?.runningTasks).toBe(1)
            expect(health.payload.volume?.sizeBytes).toBe(4_567_890)
            expect(mocks.inspectVolume).toHaveBeenCalled()
        }
    })

    it('reports unhealthy when the managed swarm service is missing (local DB)', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)
        await supervisor.ensureDesiredState()
        mocks.removeService()

        const health = await supervisor.getHealth()

        expect(health.healthy).toBe(false)
        expect(health.detail).toContain('missing')
        expect(health.payload.mode).toBe('managed')
        if (health.payload.mode === 'managed') {
            expect(health.payload.service).toBeNull()
        }
    })

    it('reports unhealthy when the managed swarm service has no running task (local DB)', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)
        await supervisor.ensureDesiredState()
        mocks.setTasks([{ Status: { State: 'pending' } }])

        const health = await supervisor.getHealth()

        expect(health.healthy).toBe(false)
        expect(health.detail).toContain('no running task')
        expect(health.payload.mode).toBe('managed')
        if (health.payload.mode === 'managed') {
            expect(health.payload.service?.runningTasks).toBe(0)
        }
    })

    it('runs a real SELECT 1 + table listing for an external database (unreachable URL → unhealthy with I/O failure in the payload)', async () => {
        const mocks = makeMocks('external')
        const supervisor = await makeSupervisor(mocks)
        await supervisor.ensureDesiredState()

        const health = await supervisor.getHealth()

        // The URL points at a non-listening port — the probe must fail,
        // recording the failure in the discriminated-union payload.
        expect(health.healthy).toBe(false)
        expect(health.payload.mode).toBe('external')
        if (health.payload.mode === 'external') {
            expect(health.payload.select1.ok).toBe(false)
            expect(health.payload.tableCount).toBe(0)
            expect(health.payload.database).toBe('deployer')
        }
    })
})

describe('global-db supervisor — process info', () => {
    it('reports the managed postgres process + connection DSN via getProcessInfo', async () => {
        const mocks = makeMocks('local')
        mocks.seedService()
        const supervisor = await makeSupervisor(mocks)

        const info = await supervisor.getProcessInfo()

        expect(info.supervisorId).toBe(GLOBAL_DB_SUPERVISOR_ID)
        expect(info.process.kind).toBe('swarm')
        expect(info.process.desired.name).toBe('deployer-postgres')
        expect(info.process.desired.image).toBe('postgres:16-alpine')
        expect(info.process.desired.mode).toBe('replicated')
        expect(info.process.live.exists).toBe(true)
        expect(info.process.live.serviceId).toBe('svc-1')
        expect(info.connection.database).toBe('deployer')
        expect(info.connection.host).toBe('127.0.0.1')
        expect(info.connection.port).toBe(1)
        // Display-safe DSN never leaks the password.
        expect(info.connection.urlSafe).not.toContain(':deployer@')
    })

    it('reports missing service state when the managed swarm service is gone', async () => {
        const mocks = makeMocks('local')
        const supervisor = await makeSupervisor(mocks)

        const info = await supervisor.getProcessInfo()

        expect(info.process.live.exists).toBe(false)
        expect(info.process.live.serviceId).toBeNull()
        expect(info.connection.database).toBe('deployer')
    })
})
