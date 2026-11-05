import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerNotFound, type DockerEngineShape } from '@deployer/docker'

import {
    makeRedisSupervisor,
    type RedisConfig,
    type RedisManagedConfig,
} from './redis-supervisor'
import {
    REDIS_CONTAINER_BASE_NAME,
    REDIS_DATA_MOUNT,
    REDIS_DATA_VOLUME,
} from './schemas'

type Fakes = {
    swarmActive?: boolean
    tasks?: { Status: { State: string } }[]
    reconcileFails?: number
}

function setup(config: Partial<RedisConfig> = {}, fakes: Fakes = {}) {
    const services = new Map<string, { ID: string; Spec: { Name: string } }>()
    const reconciled: {
        name: string
        image: string
        networks: unknown
        mounts: unknown
        labels: Record<string, string>
        command: string[] | null
    }[] = []
    const connects: [string, string][] = []
    let failures = fakes.reconcileFails ?? 0

    const engine = {
        swarmCluster: {
            isActive: () => Effect.succeed(fakes.swarmActive ?? true),
        },
        networks: {
            ensureOverlay: vi.fn(() => Effect.void),
            connectContainer: (overlay: string, container: string) =>
                Effect.sync(() => {
                    connects.push([overlay, container])
                }),
        },
        swarmServices: {
            reconcile: (spec: (typeof reconciled)[number]) =>
                failures > 0
                    ? Effect.sync(() => {
                          failures -= 1
                      }).pipe(
                          Effect.andThen(
                              Effect.fail(new Error('update out of sequence'))
                          )
                      )
                    : Effect.sync(() => {
                          reconciled.push(spec)
                          services.set(spec.name, {
                              ID: `svc-${spec.name}`,
                              Spec: { Name: spec.name },
                          })
                      }),
            inspect: (name: string) => {
                const found = services.get(name)
                return found === undefined
                    ? Effect.fail(new DockerNotFound({ resource: name }))
                    : Effect.succeed(found)
            },
            listTasks: () => Effect.succeed(fakes.tasks ?? []),
        },
    } as unknown as DockerEngineShape

    const logger = { log: vi.fn() }
    const redisConfig: RedisConfig = {
        prefix: () => '',
        image: () => undefined,
        password: () => undefined,
        explicitUrl: () => undefined,
        managed: () => ({ enabled: false }),
        runtimeOverride: () => undefined,
        ...config,
    }
    return {
        redis: makeRedisSupervisor({ engine, config: redisConfig, logger }),
        services,
        reconciled,
        connects,
        logger,
    }
}

const managed =
    (patch: Partial<RedisManagedConfig> = {}): (() => RedisManagedConfig) =>
    () => ({ enabled: true, ...patch })

describe('redis supervisor — swarm-replicated runtime (API-owned)', () => {
    it('reconciles one replicated service on the overlay with a durable AOF volume and platform labels', async () => {
        const { redis, reconciled } = setup()
        await Effect.runPromise(redis.spec.converge)
        const spec = reconciled[0]
        expect(spec?.name).toBe(REDIS_CONTAINER_BASE_NAME)
        expect(spec?.image).toBe('redis:7-alpine')
        expect(spec?.mounts).toContainEqual({
            type: 'volume',
            source: REDIS_DATA_VOLUME,
            target: REDIS_DATA_MOUNT,
            readOnly: false,
        })
        expect(spec?.labels['deployer.platform.role']).toBe('platform-redis')
        expect(spec?.networks).toEqual([
            {
                target: 'deployer-platform-overlay',
                aliases: [REDIS_CONTAINER_BASE_NAME],
            },
        ])
    })

    it('prefixes the service name, adds --requirepass when a password is set', async () => {
        const { redis, reconciled } = setup({
            prefix: () => 'stage',
            password: () => 'pw',
            image: () => 'redis:8',
        })
        await Effect.runPromise(redis.spec.converge)
        expect(reconciled[0]?.name).toBe('deployer-redis-stage')
        expect(reconciled[0]?.image).toBe('redis:8')
        expect(reconciled[0]?.command).toEqual([
            'redis-server',
            '--appendonly',
            'yes',
            '--requirepass',
            'pw',
        ])
    })

    it('retries a refused update with backoff instead of failing the first attempt', async () => {
        vi.useFakeTimers()
        try {
            const { redis, reconciled } = setup({}, { reconcileFails: 1 })
            const done = Effect.runPromise(redis.spec.converge)
            await vi.advanceTimersByTimeAsync(1_500)
            await done
            expect(reconciled).toHaveLength(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('probes healthy only while a task runs, and reports the service', async () => {
        const running = setup({}, { tasks: [{ Status: { State: 'running' } }] })
        await Effect.runPromise(running.redis.spec.converge)
        const healthy = await Effect.runPromise(running.redis.spec.probe)
        expect(healthy.healthy).toBe(true)
        expect(healthy.payload.service).toMatchObject({
            name: REDIS_CONTAINER_BASE_NAME,
            runningTasks: 1,
            exists: true,
        })

        const idle = setup({}, { tasks: [] })
        await Effect.runPromise(idle.redis.spec.converge)
        const unhealthy = await Effect.runPromise(idle.redis.spec.probe)
        expect(unhealthy.healthy).toBe(false)
        expect(unhealthy.detail).toContain('0 running tasks')
    })

    it('reports an absent service as unhealthy rather than failing the probe', async () => {
        const { redis } = setup()
        const probe = await Effect.runPromise(redis.spec.probe)
        expect(probe.healthy).toBe(false)
        expect(probe.detail).toContain('probe failed')
        expect(probe.payload.service).toBeNull()
    })

    it('is deferred until a swarm exists, with no attempt made', async () => {
        const { redis } = setup({}, { swarmActive: false })
        expect(
            await Effect.runPromise(redis.spec.blocker ?? Effect.succeed(null))
        ).toContain('deferred until an active swarm')
    })
})

describe('redis supervisor — managed runtime (compose/operator-owned)', () => {
    it('never schedules a service: it only wires the redis container to the overlay', async () => {
        const { redis, reconciled, connects, logger } = setup({
            managed: managed(),
        })
        await Effect.runPromise(redis.spec.converge)
        expect(reconciled).toHaveLength(0)
        expect(connects).toEqual([
            ['deployer-platform-overlay', REDIS_CONTAINER_BASE_NAME],
        ])
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('wired external to swarm overlay')
        )
    })

    it('bridges nothing on a plain compose stack, and is not deferred', async () => {
        const { redis, connects, logger } = setup(
            { managed: managed() },
            { swarmActive: false }
        )
        await Effect.runPromise(redis.spec.converge)
        expect(connects).toHaveLength(0)
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('no swarm to bridge')
        )
        expect(
            await Effect.runPromise(redis.spec.blocker ?? Effect.succeed('x'))
        ).toBeNull()
    })

    it('reports healthy with link-only detail', async () => {
        const { redis } = setup({ managed: managed() })
        const probe = await Effect.runPromise(redis.spec.probe)
        expect(probe).toMatchObject({
            healthy: true,
            payload: { runtime: 'managed', reachable: true },
        })
    })
})

describe('redis connection URL', () => {
    it('prefers the managed URL, then an explicit override, then managed defaults', () => {
        expect(
            setup({
                managed: managed({ url: 'redis://managed:6379' }),
            }).redis.connectionUrl()
        ).toBe('redis://managed:6379')
        expect(
            setup({
                managed: managed(),
                explicitUrl: () => 'redis://external:1',
            }).redis.connectionUrl()
        ).toBe('redis://external:1')
        expect(
            setup({
                managed: managed({ host: 'r', port: 7, password: 'p w' }),
            }).redis.connectionUrl()
        ).toBe('redis://p%20w@r:7')
        expect(setup({ managed: managed() }).redis.connectionUrl()).toBe(
            'redis://redis:6379'
        )
    })

    it('falls back to the supervised service name, with the password in the URL', () => {
        expect(setup({ password: () => 's3cret' }).redis.connectionUrl()).toBe(
            'redis://s3cret@deployer-redis:6379'
        )
        expect(
            setup({
                prefix: () => 'x',
                explicitUrl: () => 'redis://own:1',
            }).redis.connectionUrl()
        ).toBe('redis://own:1')
        expect(setup({ prefix: () => 'x' }).redis.connectionUrl()).toBe(
            'redis://deployer-redis-x:6379'
        )
    })
})

describe('redis process info', () => {
    it('shows the desired config and a live view of the service once it exists', async () => {
        const { redis } = setup(
            {},
            { tasks: [{ Status: { State: 'running' } }] }
        )
        await Effect.runPromise(redis.spec.converge)
        const info = (await Effect.runPromise(redis.spec.processInfo)) as {
            process: { live: { exists: boolean; runningTasks: number } }
            connection: { url: string }
        }
        expect(info.process.live).toMatchObject({
            exists: true,
            runningTasks: 1,
        })
        expect(info.connection.url).toBe('redis://deployer-redis:6379')
    })

    it('is the same shape before the service exists, with nothing live', async () => {
        const { redis } = setup()
        const info = (await Effect.runPromise(redis.spec.processInfo)) as {
            process: { live: { exists: boolean } }
        }
        expect(info.process.live.exists).toBe(false)
    })
})
