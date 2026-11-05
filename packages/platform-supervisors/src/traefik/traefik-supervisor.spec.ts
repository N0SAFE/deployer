import { Effect, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'
import { DockerNotFound, type DockerEngineShape } from '@deployer/docker'

import { probeEntrypoint } from './entrypoint-probe'
import {
    makeTraefikSupervisor,
    type EdgeIngressPlanInput,
    type TraefikConfig,
} from './traefik-supervisor'

const entrypoints = {
    local: { name: 'local', port: 80 },
    private: { name: 'private', port: 8001 },
    public: { name: 'public', port: 8002 },
    publicTls: { name: 'public-tls', port: 8443 },
} as const

type SpecInput = {
    name: string
    mode: string
    args: string[]
    command: string[]
    mounts: unknown[]
    endpointPorts: { publishedPort: number; targetPort: number }[]
    networks: { target: string; aliases: string[] }[]
    updateConfig: { order: string }
}

type Options = {
    lanes?: IngressLanes
    plan?: EdgeIngressPlanInput
    bootstrap?: Record<string, string> | null
    legacyForwarder?: boolean
    swarmActive?: boolean
    managed?: boolean
    reconcileError?: Error
    doorsFail?: boolean
    tasks?: { NodeID: string; Status: { State: string } }[]
    prefix?: string
}

function setup(options: Options = {}) {
    const services = new Map<string, { ID: string; Spec: { Name: string } }>()
    const reconciled: SpecInput[] = []
    const removedServices: string[] = []
    const removedContainers: string[] = []
    const connects: string[] = []
    const doors = vi.fn(
        (_context: { lanes: IngressLanes; traefikService: string }) =>
            options.doorsFail === true
                ? Effect.fail(new Error('mesh agent is not reachable'))
                : Effect.void
    )
    const prefix = options.prefix ?? ''
    const name =
        prefix === '' ? 'deployer-traefik' : `deployer-traefik-${prefix}`

    const engine = {
        swarmCluster: {
            isActive: () => Effect.succeed(options.swarmActive ?? true),
            info: () => Effect.succeed({ NodeID: 'n1' }),
        },
        containers: {
            inspect: (id: string) => {
                if (id === 'deployer-ingress-forwarder') {
                    return options.legacyForwarder === true
                        ? Effect.succeed({ Config: { Labels: {} } })
                        : Effect.fail(new DockerNotFound({ resource: id }))
                }
                return options.bootstrap === null ||
                    options.bootstrap === undefined
                    ? Effect.fail(new DockerNotFound({ resource: id }))
                    : Effect.succeed({ Config: { Labels: options.bootstrap } })
            },
            removeIfExists: (id: string) =>
                Effect.sync(() => {
                    removedContainers.push(id)
                }),
        },
        networks: {
            ensureOverlay: () => Effect.void,
            connectContainer: (_overlay: string, id: string) =>
                Effect.sync(() => {
                    connects.push(id)
                }),
        },
        volumes: { ensure: () => Effect.void },
        swarmServices: {
            reconcile: (spec: SpecInput) =>
                options.reconcileError === undefined
                    ? Effect.sync(() => {
                          reconciled.push(spec)
                          services.set(spec.name, {
                              ID: `svc-${spec.name}`,
                              Spec: { Name: spec.name },
                          })
                      })
                    : Effect.fail(options.reconcileError),
            inspect: (id: string) => {
                const found = services.get(id)
                return found === undefined
                    ? Effect.fail(new DockerNotFound({ resource: id }))
                    : Effect.succeed(found)
            },
            listTasks: () =>
                Effect.succeed(
                    options.tasks ?? [
                        { NodeID: 'n1', Status: { State: 'running' } },
                    ]
                ),
            remove: (id: string) =>
                Effect.sync(() => {
                    removedServices.push(id)
                    services.delete(id)
                }),
        },
    } as unknown as DockerEngineShape

    const logger = { log: vi.fn(), warn: vi.fn() }
    const config: TraefikConfig = {
        prefix: () => prefix,
        serviceName: () => name,
        image: () => 'traefik:v3',
        apiTarget: () => 'deployer-api',
        apiPort: () => 3005,
        configPath: 'internal/ingress/traefik-config',
        apiHostname: () => 'api.deployer.localhost',
        apiOrigin: () => 'http://api.deployer.localhost',
        webOrigin: () => 'http://web.deployer.localhost',
        providerToken: () => ({ header: 'X-Token', value: 'derived' }),
        acmeEmail: () => 'ops@example.com',
        entrypoints,
        acmeResolver: 'letsencrypt',
        externallyManaged: () => options.managed ?? false,
        runtimeOverride: () => undefined,
        selfHostname: () => undefined,
        lanes: Effect.succeed(options.lanes ?? defaultIngressLanes()),
        edgePlan: () => options.plan ?? { publishedPorts: [], tls: 'none' },
        publishNodeDoors: doors,
        entrypointProbe: () =>
            Effect.succeed({
                reachable: true,
                host: name,
                port: 80,
                statusCode: 404,
                latencyMs: 1,
            }),
    }
    return {
        traefik: makeTraefikSupervisor({ engine, config, logger }),
        reconciled,
        removedServices,
        removedContainers,
        connects,
        doors,
        logger,
        services,
    }
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)
const direct = (tls: boolean): EdgeIngressPlanInput =>
    tls
        ? {
              publishedPorts: [
                  { published: 80, entrypoint: 'public' },
                  { published: 443, entrypoint: 'public-tls' },
              ],
              tls: 'acme',
          }
        : {
              publishedPorts: [{ published: 80, entrypoint: 'public' }],
              tls: 'none',
          }

describe('traefik — the service', () => {
    it('is ONE global service aliased on the overlay, polling its routes from the API with no socket and no volume', async () => {
        const { traefik, reconciled } = setup()
        await run(traefik.spec.converge)
        const spec = reconciled[0]
        expect(spec).toMatchObject({
            name: 'deployer-traefik',
            mode: 'global',
            command: [],
            mounts: [],
        })
        expect(spec?.networks).toEqual([
            {
                target: 'deployer-platform-overlay',
                aliases: ['deployer-traefik'],
            },
        ])
        expect(spec?.args).toContain(
            '--providers.http.endpoint=http://deployer-api:3005/internal/ingress/traefik-config'
        )
        expect(spec?.args).toContain('--providers.http.headers.X-Token=derived')
        expect(
            spec?.args.some((arg) =>
                /^--providers\.(docker|swarm|file)/.test(arg)
            )
        ).toBe(false)
        expect(spec?.args).toEqual(
            expect.arrayContaining([
                '--entrypoints.local.address=:80',
                '--entrypoints.private.address=:8001',
                '--entrypoints.public.address=:8002',
            ])
        )
    })

    it('publishes NO host port for the local, private and tunnel lanes: the door owns the entry port', async () => {
        const { traefik, reconciled } = setup()
        await run(traefik.spec.converge)
        expect(reconciled[0]?.endpointPorts).toEqual([])
        expect(reconciled[0]?.updateConfig.order).toBe('start-first')
    })

    it('publishes only the acknowledged `direct` edge, and stops first so a host port can be released', async () => {
        const { traefik, reconciled } = setup({ plan: direct(false) })
        await run(traefik.spec.converge)
        expect(reconciled[0]?.endpointPorts).toEqual([
            expect.objectContaining({ publishedPort: 80, targetPort: 8002 }),
        ])
        expect(reconciled[0]?.updateConfig.order).toBe('stop-first')
    })

    it('adds :443, the HTTPS redirect, an ACME resolver and the ACME volume for `direct` + TLS', async () => {
        const { traefik, reconciled } = setup({ plan: direct(true) })
        await run(traefik.spec.converge)
        const spec = reconciled[0]
        expect(spec?.endpointPorts).toContainEqual(
            expect.objectContaining({ publishedPort: 443, targetPort: 8443 })
        )
        expect(spec?.args).toContain(
            '--entrypoints.public.http.redirections.entrypoint.to=public-tls'
        )
        expect(spec?.args).toContain(
            '--certificatesresolvers.letsencrypt.acme.email=ops@example.com'
        )
        expect(spec?.args).toContain(
            '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=public'
        )
        expect(spec?.mounts).toEqual([
            expect.objectContaining({ target: '/acme' }),
        ])
    })

    it('prefixes the service name and hands the doors the right names', async () => {
        const { traefik, reconciled, doors } = setup({ prefix: 'acme' })
        await run(traefik.spec.converge)
        expect(reconciled[0]?.name).toBe('deployer-traefik-acme')
        expect(doors).toHaveBeenCalledWith(
            expect.objectContaining({ traefikService: 'deployer-traefik-acme' })
        )
    })
})

describe('traefik — convergence', () => {
    it('publishes the doors plan with the lanes in effect, every convergence', async () => {
        const lanes = {
            ...defaultIngressLanes(8080),
            private: {
                enabled: true,
                domain: 'deployer.internal',
                exposeOnLan: false,
            },
        } as IngressLanes
        const { traefik, doors } = setup({ lanes })
        await run(traefik.spec.converge)
        expect(doors).toHaveBeenCalledWith(
            expect.objectContaining({
                lanes: expect.objectContaining({ entryPort: 8080 }),
            })
        )
    })

    it('still converges when the doors cannot be published: only the doors are missing', async () => {
        const { traefik, logger } = setup({ doorsFail: true })
        await run(traefik.spec.converge)
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining(
                'Node doors not published (mesh agent is not reachable)'
            )
        )
    })

    it("removes the legacy API-owned forwarder the agent's door replaces", async () => {
        const { traefik, removedContainers, logger } = setup({
            legacyForwarder: true,
        })
        await run(traefik.spec.converge)
        expect(removedContainers).toEqual(['deployer-ingress-forwarder'])
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining(
                'Removed the legacy deployer-ingress-forwarder'
            )
        )
    })

    it('removes nothing when the forwarder is not there', async () => {
        const { traefik, removedContainers } = setup()
        await run(traefik.spec.converge)
        expect(removedContainers).toHaveLength(0)
    })

    it('fails with a deterministic EntryPortConflict, removing the service, when a `direct` port is already bound', async () => {
        const { traefik, removedServices } = setup({
            plan: direct(false),
            reconcileError: new Error(
                'failed to bind host port 0.0.0.0:80/tcp: address already in use'
            ),
        })
        await expect(run(traefik.spec.converge)).rejects.toMatchObject({
            _tag: 'EntryPortConflict',
            port: 80,
        })
        expect(removedServices).toEqual(['deployer-traefik'])
    })

    it('rethrows any other engine failure untouched', async () => {
        vi.useFakeTimers()
        try {
            const { traefik, removedServices } = setup({
                reconcileError: new Error('daemon exploded'),
            })
            const done = run(traefik.spec.converge).catch(
                (error: unknown) => error
            )
            await vi.advanceTimersByTimeAsync(120_000)
            expect(String(await done)).toContain('daemon exploded')
            expect(removedServices).toHaveLength(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('attaches this API container to the overlay when it runs in one', async () => {
        const { connects } = setup()
        const inside = makeTraefikSupervisor({
            engine: {
                swarmCluster: { isActive: () => Effect.succeed(true) },
                containers: {
                    inspect: () =>
                        Effect.fail(new DockerNotFound({ resource: 'x' })),
                    removeIfExists: () => Effect.void,
                },
                networks: {
                    ensureOverlay: () => Effect.void,
                    connectContainer: (_o: string, id: string) =>
                        Effect.sync(() => {
                            connects.push(id)
                        }),
                },
                volumes: { ensure: () => Effect.void },
                swarmServices: {
                    reconcile: () => Effect.void,
                    inspect: () => Effect.succeed({ ID: 'svc' }),
                    listTasks: () => Effect.succeed([]),
                },
            } as unknown as DockerEngineShape,
            logger: { log: vi.fn(), warn: vi.fn() },
            config: {
                ...({} as TraefikConfig),
                prefix: () => '',
                serviceName: () => 'deployer-traefik',
                image: () => 't',
                apiTarget: () => 'a',
                apiPort: () => 1,
                configPath: 'p',
                apiHostname: () => 'h',
                apiOrigin: () => 'o',
                webOrigin: () => 'w',
                providerToken: () => ({ header: 'H', value: 'v' }),
                acmeEmail: () => undefined,
                entrypoints,
                acmeResolver: 'le',
                externallyManaged: () => false,
                runtimeOverride: () => undefined,
                selfHostname: () => 'aaaaaaaaaaaa',
                lanes: Effect.succeed(defaultIngressLanes()),
                edgePlan: () => ({ publishedPorts: [], tls: 'none' }),
                publishNodeDoors: () => Effect.void,
            },
        })
        await run(inside.spec.converge)
        expect(connects).toEqual(['aaaaaaaaaaaa'])
    })

    it('is link-only when the deployment owns the ingress', async () => {
        const { traefik, reconciled } = setup({ managed: true })
        await run(traefik.spec.converge)
        expect(reconciled).toHaveLength(0)
    })

    it('fails with a typed error when there is no swarm and nothing owns the ingress', async () => {
        const { traefik } = setup({ swarmActive: false })
        await expect(run(traefik.spec.converge)).rejects.toMatchObject({
            _tag: 'SupervisedResourceUnavailable',
        })
    })
})

describe('traefik — bootstrap handover', () => {
    it("defers while setup's bootstrap ingress still serves, and the background watch converges once it lets go", async () => {
        vi.useFakeTimers()
        try {
            const { traefik } = setup({
                bootstrap: { 'deployer.bootstrap': 'true' },
            })
            expect(
                await run(traefik.spec.blocker ?? Effect.succeed(null))
            ).toContain('bootstrap ingress')

            const ensure = vi.fn(() => Effect.void)
            const fiber = Effect.runFork(
                traefik.background(Effect.suspend(ensure))
            )
            await vi.advanceTimersByTimeAsync(3_100)
            expect(ensure).toHaveBeenCalledTimes(1)
            await Effect.runPromise(Fiber.interrupt(fiber))
        } finally {
            vi.useRealTimers()
        }
    })

    it('treats a container without the bootstrap label as not a handover, and never polls', async () => {
        vi.useFakeTimers()
        try {
            const { traefik } = setup({
                bootstrap: { 'deployer.platform.role': 'ingress' },
            })
            expect(
                await run(traefik.spec.blocker ?? Effect.succeed('x'))
            ).toBeNull()
            const ensure = vi.fn(() => Effect.void)
            const fiber = Effect.runFork(
                traefik.background(Effect.suspend(ensure))
            )
            await vi.advanceTimersByTimeAsync(10_000)
            expect(ensure).not.toHaveBeenCalled()
            await Effect.runPromise(Fiber.interrupt(fiber))
        } finally {
            vi.useRealTimers()
        }
    })

    it('is deferred until a swarm exists, unless the deployment owns the ingress', async () => {
        expect(
            await run(
                setup({ swarmActive: false }).traefik.spec.blocker ??
                    Effect.succeed(null)
            )
        ).toContain('deferred until an active swarm')
        expect(
            await run(
                setup({ swarmActive: false, managed: true }).traefik.spec
                    .blocker ?? Effect.succeed('x')
            )
        ).toBeNull()
    })
})

describe('traefik — probe and process info', () => {
    it("is healthy when this node's task runs and its entrypoint answers", async () => {
        const { traefik } = setup()
        await run(traefik.spec.converge)
        const probe = await run(traefik.spec.probe)
        expect(probe.healthy).toBe(true)
        expect(probe.detail).toContain(
            'serving local via deployer-traefik (HTTP 404)'
        )
    })

    it("is unhealthy when this node's task is not running, or missing", async () => {
        vi.useFakeTimers()
        try {
            const idle = setup({
                tasks: [{ NodeID: 'n1', Status: { State: 'pending' } }],
            })
            // Convergence verifies a running task and retries with backoff before giving up; the service exists by then.
            const done = run(idle.traefik.spec.converge).catch(() => undefined)
            await vi.advanceTimersByTimeAsync(120_000)
            await done
            expect((await run(idle.traefik.spec.probe)).detail).toContain(
                'ingress task not running on this node (state=pending)'
            )
        } finally {
            vi.useRealTimers()
        }
        expect((await run(setup().traefik.spec.probe)).detail).toBe(
            'ingress swarm service missing on this node'
        )
    })

    it("only counts THIS node's task: another node being down is not this node's problem", async () => {
        const { traefik } = setup({
            tasks: [
                { NodeID: 'other', Status: { State: 'failed' } },
                { NodeID: 'n1', Status: { State: 'running' } },
            ],
        })
        await run(traefik.spec.converge)
        expect((await run(traefik.spec.probe)).healthy).toBe(true)
    })

    it('reports the lanes, the provider endpoint and the local console URL', async () => {
        const { traefik } = setup({ lanes: { ...defaultIngressLanes(8080) } })
        await run(traefik.spec.converge)
        const info = (await run(traefik.spec.processInfo)) as {
            entry: unknown
            urls: { entryUrl: string }
            config: unknown
        }
        expect(info.entry).toEqual({ port: 8080, isDefault80: false })
        expect(info.urls.entryUrl).toBe('http://web.deployer.localhost:8080')
        expect(info.config).toEqual({
            providerEndpoint:
                'http://deployer-api:3005/internal/ingress/traefik-config',
            lanes: ['local'],
        })
        expect(traefik.providerEndpoint()).toBe(
            'http://deployer-api:3005/internal/ingress/traefik-config'
        )
    })
})

describe('probeEntrypoint', () => {
    it('reports every candidate when none answers, without failing', async () => {
        const observation = await run(probeEntrypoint(['127.0.0.1'], 1, 200))
        expect(observation).toMatchObject({
            reachable: false,
            host: '127.0.0.1',
            port: 1,
            statusCode: null,
        })
    })
})
