import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerNotFound, type DockerEngineShape } from '@deployer/docker'

import { parsePostgresUrl } from './connection'
import { probeExternalDatabase } from './external-probe'
import {
    makeGlobalDbSupervisor,
    type GlobalDbConfig,
} from './global-db-supervisor'

type Fakes = {
    swarmActive?: boolean
    existing?: boolean
    tasks?: { Status: { State: string } }[]
    volume?: { Mountpoint: string; UsageData?: { Size: number } } | null
}

function setup(config: Partial<GlobalDbConfig> = {}, fakes: Fakes = {}) {
    const services = new Map<
        string,
        {
            ID: string
            CreatedAt: string
            UpdatedAt: string
            Spec: { Name: string }
        }
    >()
    const name = 'deployer-postgres'
    if (fakes.existing === true)
        services.set(name, {
            ID: 'svc',
            CreatedAt: 'c',
            UpdatedAt: 'u',
            Spec: { Name: name },
        })
    const reconciled: { name: string; networks: unknown }[] = []
    const removedContainers: string[] = []

    const engine = {
        swarmCluster: {
            isActive: () => Effect.succeed(fakes.swarmActive ?? true),
        },
        containers: {
            removeIfExists: (id: string) =>
                Effect.sync(() => {
                    removedContainers.push(id)
                }),
        },
        networks: { ensureOverlay: () => Effect.void },
        volumes: {
            inspect: () =>
                fakes.volume === null || fakes.volume === undefined
                    ? Effect.fail(new DockerNotFound({ resource: 'volume' }))
                    : Effect.succeed(fakes.volume),
        },
        swarmServices: {
            reconcile: (spec: { name: string; networks: unknown }) =>
                Effect.sync(() => {
                    reconciled.push(spec)
                    services.set(spec.name, {
                        ID: 'svc',
                        CreatedAt: 'c',
                        UpdatedAt: 'u',
                        Spec: { Name: spec.name },
                    })
                }),
            inspect: (id: string) => {
                const found = services.get(id)
                return found === undefined
                    ? Effect.fail(new DockerNotFound({ resource: id }))
                    : Effect.succeed(found)
            },
            listTasks: () => Effect.succeed(fakes.tasks ?? []),
        },
    } as unknown as DockerEngineShape

    const logger = { log: vi.fn() }
    const fullConfig: GlobalDbConfig = {
        prefix: () => '',
        identity: () => ({
            databaseName: 'deployer',
            username: 'u',
            password: 'p',
            image: 'postgres:16-alpine',
        }),
        composeManaged: () => false,
        runtimeOverride: () => undefined,
        provisioning: () => 'local',
        databaseUrl: () => 'postgres://u:p@global-db:5432/deployer',
        ...config,
    }
    return {
        db: makeGlobalDbSupervisor({ engine, config: fullConfig, logger }),
        reconciled,
        removedContainers,
        logger,
    }
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)

describe('global-db — convergence', () => {
    it('schedules Postgres as a swarm service on the overlay, after removing the container-era copy', async () => {
        const { db, reconciled, removedContainers } = setup()
        await run(db.spec.converge)
        expect(removedContainers).toEqual(['deployer-postgres-dev'])
        expect(reconciled[0]?.name).toBe('deployer-postgres')
        expect(reconciled[0]?.networks).toEqual([
            expect.objectContaining({
                target: 'deployer-platform-overlay',
                aliases: expect.arrayContaining(['global-db']),
            }),
        ])
    })

    it('never touches an externally-managed database', async () => {
        const { db, reconciled, removedContainers } = setup({
            provisioning: () => 'external',
        })
        await run(db.spec.converge)
        expect(reconciled).toHaveLength(0)
        expect(removedContainers).toHaveLength(0)
    })

    it('is link-only when the deployment owns Postgres', async () => {
        const { db, reconciled, logger } = setup({ composeManaged: () => true })
        await run(db.spec.converge)
        expect(reconciled).toHaveLength(0)
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('link-only')
        )
    })

    it('fails with a typed error instead of running a second container copy when there is no swarm', async () => {
        const { db, removedContainers } = setup({}, { swarmActive: false })
        await expect(run(db.spec.converge)).rejects.toMatchObject({
            _tag: 'SupervisedResourceUnavailable',
        })
        expect(removedContainers).toHaveLength(0)
    })

    it('is deferred until a swarm exists', async () => {
        const { db } = setup({}, { swarmActive: false })
        expect(await run(db.spec.blocker ?? Effect.succeed(null))).toContain(
            'deferred until an active swarm'
        )
    })
})

describe('global-db — managed probe', () => {
    it('is healthy with a running task, reporting service, volume usage and port', async () => {
        const { db } = setup(
            {},
            {
                existing: true,
                tasks: [{ Status: { State: 'running' } }],
                volume: { Mountpoint: '/data', UsageData: { Size: 4096 } },
            }
        )
        const probe = await run(db.spec.probe)
        expect(probe.healthy).toBe(true)
        expect(probe.payload).toMatchObject({
            mode: 'managed',
            volume: {
                name: 'deployer_postgres_data',
                mountpoint: '/data',
                sizeBytes: 4096,
            },
        })
        expect(probe.detail).toContain('tasks=1')
    })

    it('distinguishes an idle service from a missing one', async () => {
        expect(
            (await run(setup({}, { existing: true, tasks: [] }).db.spec.probe))
                .detail
        ).toContain('exists but has no running task')
        const missing = await run(setup().db.spec.probe)
        expect(missing).toMatchObject({
            healthy: false,
            detail: 'managed Postgres swarm service missing',
        })
        expect(missing.payload).toMatchObject({ service: null, volume: null })
    })
})

describe('global-db — external probe', () => {
    it('reports an unreachable or absent database as unhealthy rather than failing', async () => {
        const none = await run(
            setup({ provisioning: () => 'external', databaseUrl: () => '' }).db
                .spec.probe
        )
        expect(none).toMatchObject({
            healthy: false,
            payload: { mode: 'external', select1: { ok: false } },
        })
        const closed = await run(
            probeExternalDatabase('postgres://u:p@127.0.0.1:1/deployer')
        )
        expect(closed).toMatchObject({
            select1: { ok: false },
            database: 'deployer',
        })
    })
})

describe('process info and DSN parsing', () => {
    it('shows the service and the connection', async () => {
        const { db } = setup(
            {},
            { existing: true, tasks: [{ Status: { State: 'running' } }] }
        )
        const info = (await run(db.spec.processInfo)) as {
            process: { live: { exists: boolean } }
            connection: { host: string; port: number; urlSafe: string }
        }
        expect(info.process.live.exists).toBe(true)
        expect(info.connection).toMatchObject({
            host: 'global-db',
            port: 5432,
            urlSafe: 'postgres://u:***@global-db:5432/deployer',
        })
    })

    it('parses defaults and reports garbage as unknown', () => {
        expect(parsePostgresUrl('postgres://h/')).toMatchObject({
            host: 'h',
            port: null,
            database: 'postgres',
            user: 'unknown',
        })
        expect(parsePostgresUrl('')).toMatchObject({
            url: '',
            urlSafe: '',
            host: 'unknown',
        })
        expect(parsePostgresUrl('not a url')).toMatchObject({
            host: 'unknown',
            urlSafe: 'not a url',
        })
    })
})
