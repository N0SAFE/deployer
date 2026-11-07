import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'
import type { DockerEngineShape } from '@deployer/docker'
import { DockerEngine } from '@deployer/docker'
import { provideTo } from '@deployer/effect-core'

import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import {
    TEST_TUNNEL_ID,
    testEdgeRegistry,
} from '../../edge/testing/edge-registry.fixture'
import { EnvHostnameService } from '../../platform-ingress/services/hostname.service'
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service'
import { PlatformConfigService } from '../../platform-ingress/services/platform-config.service'
import { PlatformRoutesSource } from '../../platform-ingress/services/platform-routes-source.service'
import { PlatformWebTargetService } from '../../platform-ingress/services/platform-web-target.service'
import { TraefikRepository } from '../repositories/traefik.repository'

import { TraefikIngressConfigService } from './traefik-ingress-config.service'

import type { EnvService } from '../../../../config/env/env.module'
import type { PlatformConfigServiceShape } from '../../platform-ingress/services/platform-config.service'
import type { SupervisedRoute } from '../../platform-ingress/services/platform-routes-source.service'
import type { TraefikRepositoryShape } from '../repositories/traefik.repository'

async function makeService(
    options: {
        lanes?: IngressLanes
        routes?: SupervisedRoute[]
        setupFile?: string
        webTarget?: string | null
    } = {}
) {
    const dir = await mkdtemp(
        join(process.env.TMPDIR ?? '/tmp', 'ingress-config-')
    )
    if (options.setupFile !== undefined)
        await writeFile(join(dir, 'dynamic-setup.yml'), options.setupFile)
    const values: Record<string, unknown> = {
        DEPLOYER_PREFIX: '',
        API_PORT: 3005,
        DEPLOYER_API_TARGET: 'deployer-api',
        TRAEFIK_CONFIG_BASE_PATH: dir,
    }
    const env = {
        get: vi.fn((key: string) => values[key]),
    } as unknown as EnvService
    const service = provideTo(
        new TraefikIngressConfigService.live(env, new EnvHostnameService(env)),
        (effect) =>
            effect.pipe(
                // `DEPLOYER_API_TARGET` is set, so the self-resolver never inspects a container; the tests
                // touch no Docker API and an empty engine is asserted to the interface.
                Effect.provideService(DockerEngine, {
                    containers: {},
                } as unknown as DockerEngineShape),
                Effect.provideService(IngressLanesService, {
                    getLanes: () =>
                        Effect.succeed(options.lanes ?? defaultIngressLanes()),
                    setLanes: () => Effect.die('unused'),
                }),
                Effect.provideService(PlatformWebTargetService, {
                    resolveWebTarget: () =>
                        Effect.succeed(
                            options.webTarget === undefined
                                ? 'deployer-managed-web'
                                : options.webTarget
                        ),
                }),
                Effect.provideService(PlatformRoutesSource, {
                    listSupervisedRoutes: () =>
                        Effect.succeed(options.routes ?? []),
                }),
                Effect.provideService(TraefikRepository, {
                    getAllServiceConfigs: () => Effect.succeed([]),
                    getServiceTargetsByConfigId: () => Effect.succeed([]),
                } as unknown as TraefikRepositoryShape),
                Effect.provideService(PlatformConfigService, {
                    getManagedWebOrigin: () => Effect.succeed(null),
                    getManagedWebTunnel: () => Effect.succeed(null),
                } as unknown as PlatformConfigServiceShape),
                Effect.provideService(
                    EdgeProviderRegistry,
                    testEdgeRegistry().registry
                )
            ) as Effect.Effect<unknown>
    )
    // The service's Effects, run to Promises: the assertions below read like the calls they check.
    return {
        buildDynamicConfig: () =>
            Effect.runPromise(service.buildDynamicConfig()),
        setupRouteTarget: (apiBackend: string) =>
            Effect.runPromise(service.setupRouteTarget(apiBackend)),
    }
}

describe('TraefikIngressConfigService', () => {
    it('publishes the console on the local lane of a fresh install', async () => {
        const { http } = await (await makeService()).buildDynamicConfig()
        expect(http.routers['platform-api-local']?.rule).toBe(
            'Host(`api.deployer.localhost`)'
        )
        expect(http.routers['platform-web-local']?.rule).toBe(
            'Host(`web.deployer.localhost`)'
        )
        expect(http.services['platform-api-svc']).toEqual({
            loadBalancer: { servers: [{ url: 'http://deployer-api:3005' }] },
        })
        expect(
            Object.keys(http.routers).every((name) => name.endsWith('-local'))
        ).toBe(true)
    })

    it("falls back to the API's console when the web app is not running", async () => {
        const { http } = await (
            await makeService({ webTarget: null })
        ).buildDynamicConfig()
        expect(http.routers['platform-web-local']).toBeUndefined()
        expect(
            http.services['platform-web-console-svc']?.loadBalancer.servers[0]
                ?.url
        ).toBe('http://deployer-api:3005')
    })

    it('routes deployments by label on every lane and by custom domain on the public one', async () => {
        const lanes: IngressLanes = {
            ...defaultIngressLanes(),
            public: {
                provider: TEST_TUNNEL_ID,
                domain: 'apps.example.com',
                acknowledgedInboundPorts: false,
                options: { account: 'acc' },
            },
        }
        const routes: SupervisedRoute[] = [
            {
                name: 'deploy-web-shop',
                label: 'web-shop',
                hosts: ['shop.example.com'],
                visibility: 'public',
                source: 'deployment',
                target: { kind: 'container', name: 'shop-web-1', port: 3000 },
            },
        ]
        const { http } = await (
            await makeService({ lanes, routes })
        ).buildDynamicConfig()
        expect(http.routers['deploy-web-shop-local']?.rule).toBe(
            'Host(`web-shop.deployer.localhost`)'
        )
        expect(http.routers['deploy-web-shop-public']?.rule).toBe(
            '(Host(`web-shop.apps.example.com`) || Host(`shop.example.com`))'
        )
        expect(
            http.services['deploy-web-shop-svc']?.loadBalancer.servers[0]?.url
        ).toBe('http://shop-web-1:3000')
    })

    describe('the setup hostname', () => {
        it("stays with the wizard while setup's handover file still points at setup", async () => {
            const service = await makeService({
                setupFile:
                    'services:\n  x:\n    loadBalancer:\n      servers:\n        - url: "http://setup:3016"\n',
            })
            expect(
                await service.setupRouteTarget('http://deployer-api:3005')
            ).toEqual({ url: 'http://setup:3016', servedBySetup: true })
            const { http } = await service.buildDynamicConfig()
            expect(
                http.routers['platform-setup-redirect-local']
            ).toBeUndefined()
        })

        it('belongs to the API, with the reload redirect, once setup points at the done page', async () => {
            const service = await makeService({
                setupFile: '- url: "http://deployer-api:3005/setup/done"\n',
            })
            expect(
                await service.setupRouteTarget('http://deployer-api:3005')
            ).toEqual({ url: 'http://deployer-api:3005', servedBySetup: false })
            const { http } = await service.buildDynamicConfig()
            expect(http.routers['platform-setup-redirect-local']).toMatchObject(
                { middlewares: ['platform-setup-redirect'], priority: 3100 }
            )
            expect(http.middlewares?.['platform-setup-redirect']).toBeDefined()
        })

        it('belongs to the API when setup never wrote a file', async () => {
            expect(
                await (await makeService()).setupRouteTarget('http://api:3005')
            ).toEqual({ url: 'http://api:3005', servedBySetup: false })
        })
    })
})
