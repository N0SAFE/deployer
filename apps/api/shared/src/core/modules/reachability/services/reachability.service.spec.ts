import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'
import { provideTo } from '@deployer/effect-core'
import { NodeConfigRepository } from '@deployer/node-state'

import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import {
    TEST_TUNNEL_ID,
    testEdgeRegistry,
    type TestTunnelEdgeProvider,
} from '../../edge/testing/edge-registry.fixture'
import { EgressService, EgressRequestError } from '../../egress/egress.service'
import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service'
import { NodeNetworkConfigRepository } from '../repositories/node-network-config.repository'

import { PublicEdgeService } from './public-edge.service'
import { ReachabilityService } from './reachability.service'

import type { ReachabilityServiceShape } from './reachability.service'
import type { ClusterSettingsShape } from '../../mesh-node/cluster-settings'
import type { IngressLanesServiceShape } from '../../platform-ingress/services/ingress-lanes.service'
import type { NodeNetworkConfigRepositoryShape } from '../repositories/node-network-config.repository'

const tunnelLane = {
    provider: TEST_TUNNEL_ID,
    domain: 'apps.example.com',
    acknowledgedInboundPorts: false,
    options: { account: 'acc-1' },
}
const directLane = (tls: boolean) => ({
    provider: 'direct',
    domain: 'apps.example.com',
    acknowledgedInboundPorts: true,
    options: { tls },
})

/** The service's Effects, run to Promises: the assertions below read like the calls they check. */
type Promised<S> = {
    [K in keyof S]: S[K] extends (
        ...args: infer A
    ) => Effect.Effect<infer R, unknown, unknown>
        ? (...args: A) => Promise<R>
        : S[K]
}
const promised = <S extends object>(service: S): Promised<S> =>
    new Proxy(service, {
        get:
            (target, key) =>
            (...args: unknown[]) =>
                Effect.runPromise(
                    (
                        Reflect.get(target, key) as (
                            ...a: unknown[]
                        ) => Effect.Effect<unknown>
                    )(...args)
                ),
    }) as Promised<S>

describe('ReachabilityService', () => {
    let service: Promised<ReachabilityServiceShape>
    let lanes: IngressLanes
    let tunnel: TestTunnelEdgeProvider
    let lanesService: IngressLanesServiceShape
    let egress: {
        external: Mock
        operator: Mock
        fixedExternal: Mock
        probeUserAddress: Mock
        probeOperatorPeer: Mock
    }

    beforeEach(() => {
        lanes = defaultIngressLanes()
        const edges = testEdgeRegistry()
        tunnel = edges.tunnel
        egress = {
            external: vi.fn(),
            operator: vi.fn(),
            fixedExternal: vi.fn(),
            probeUserAddress: vi
                .fn()
                .mockReturnValue(Effect.succeed({ valid: false })),
            probeOperatorPeer: vi.fn().mockReturnValue(
                Effect.succeed({
                    url: '',
                    reachable: false,
                    probeUrl: '',
                    latencyMs: 0,
                })
            ),
        }
        const nodeNetworkConfigs: NodeNetworkConfigRepositoryShape = {
            findByNodeId: vi.fn(() => Effect.succeed(null)),
            list: vi.fn(() => Effect.succeed([])),
            upsert: vi.fn(() => Effect.void),
        }
        lanesService = {
            getLanes: vi.fn(() => Effect.succeed(lanes)),
            setLanes: vi.fn(() => Effect.die('unused')),
        }
        const publicEdge = new PublicEdgeService.live('')
        // Only the tags the operations yield are provided; the fakes read nothing else.
        service = promised(
            provideTo(new ReachabilityService.live(), (effect) =>
                effect.pipe(
                    Effect.provideService(
                        NodeConfigRepository,
                        {
                            find: vi.fn(() =>
                                Effect.succeed({
                                    nodeId: '00000000-0000-0000-0000-000000000001',
                                })
                            ),
                        } as never
                    ),
                    Effect.provideService(
                        NodeNetworkConfigRepository,
                        nodeNetworkConfigs as never
                    ),
                    Effect.provideService(
                        IngressLanesService,
                        lanesService as never
                    ),
                    Effect.provideService(
                        ClusterSettings,
                        {} as ClusterSettingsShape
                    ),
                    Effect.provideService(
                        EdgeProviderRegistry,
                        edges.registry as never
                    ),
                    Effect.provideService(
                        PublicEdgeService,
                        publicEdge as never
                    ),
                    Effect.provideService(EgressService, egress as never)
                ) as Effect.Effect<unknown>
            )
        )
    })

    describe('getNodePublicUrl', () => {
        it('is null on a local-only install — nothing is on the internet', async () => {
            expect(await service.getNodePublicUrl()).toBeNull()
        })

        it('is the API host on the public domain over https when the edge terminates TLS (never the unrouted apex)', async () => {
            lanes = { ...lanes, public: tunnelLane }
            expect(await service.getNodePublicUrl()).toBe(
                'https://api.apps.example.com'
            )
        })

        it('follows the edge provider for plain HTTP', async () => {
            lanes = { ...lanes, public: directLane(false) }
            expect(await service.getNodePublicUrl()).toBe(
                'http://api.apps.example.com'
            )
            lanes = { ...lanes, public: directLane(true) }
            expect(await service.getNodePublicUrl()).toBe(
                'https://api.apps.example.com'
            )
        })

        it('is null when the console is private, even with a public lane', async () => {
            lanes = {
                ...lanes,
                consoleVisibility: 'private',
                public: tunnelLane,
            }
            expect(await service.getNodePublicUrl()).toBeNull()
        })
    })

    describe('checkDomainGate', () => {
        it('lets a local-only install prepare its domains', async () => {
            expect((await service.checkDomainGate()).allowed).toBe(true)
        })

        it('allows domains once the public edge reports itself provisioned', async () => {
            lanes = { ...lanes, public: tunnelLane }
            expect((await service.checkDomainGate()).allowed).toBe(true)
        })

        it("blocks domains while the public edge is not provisioned, with the provider's own reason", async () => {
            lanes = { ...lanes, public: directLane(true) }
            const gate = await service.checkDomainGate()
            expect(gate.allowed).toBe(false)
            expect(gate.reason).toMatch(/public IP/)
        })

        it('blocks domains on a lane whose provider is not registered here', async () => {
            tunnel.provisioned = true
            lanes = {
                ...lanes,
                public: { ...tunnelLane, provider: 'gone-provider' },
            }
            const gate = await service.checkDomainGate()
            expect(gate.allowed).toBe(false)
            expect(gate.reason).toContain('gone-provider')
        })
    })

    describe('outbound requests go through the egress policy', () => {
        const body = (text: string) => ({
            status: 200,
            headers: {},
            url: '',
            body: new TextEncoder().encode(text),
        })
        const denied = () =>
            new EgressRequestError({
                target: 'external',
                reason: 'Target not allowed by the network policy',
                failure: 'denied',
            })

        it('getPublicIp asks only the fixed echo hosts, with no redirects of its own choosing', async () => {
            egress.fixedExternal.mockReturnValueOnce(
                Effect.succeed(body('203.0.113.7\n'))
            )
            expect(await service.getPublicIp()).toBe('203.0.113.7')
            expect(egress.fixedExternal).toHaveBeenCalledWith(
                { url: 'https://checkip.amazonaws.com' },
                ['checkip.amazonaws.com']
            )
        })

        it('getPublicIp ignores an answer that is not an IP and tries the next host', async () => {
            egress.fixedExternal
                .mockReturnValueOnce(
                    Effect.succeed(body('<html>captive portal</html>'))
                )
                .mockReturnValueOnce(Effect.succeed(body('198.51.100.9')))
            expect(await service.getPublicIp()).toBe('198.51.100.9')
            expect(egress.fixedExternal).toHaveBeenCalledTimes(2)
        })

        it('getPublicIp is null when every host is refused or down', async () => {
            egress.fixedExternal.mockReturnValue(Effect.fail(denied()))
            expect(await service.getPublicIp()).toBeNull()
        })

        it('verifyPublicAddress probes through the external policy', async () => {
            await service.verifyPublicAddress('203.0.113.10')
            expect(egress.probeUserAddress).toHaveBeenCalledWith(
                '203.0.113.10',
                ['/mesh/ping', '/health'],
                expect.any(Function)
            )
        })

        it('checkMeshUrlReachability probes through the operator policy', async () => {
            await service.checkMeshUrlReachability('http://10.0.0.5:3005')
            expect(egress.probeOperatorPeer).toHaveBeenCalledWith(
                'http://10.0.0.5:3005',
                '/mesh/ping',
                '/health'
            )
        })

        it('a refused mesh target is unreachable with the generic reason, not a resolved address', async () => {
            // The egress layer is where a refusal becomes a generic message; the service only
            // forwards the probe's verdict, so a caller never sees a resolved address.
            egress.probeOperatorPeer.mockReturnValue(
                Effect.succeed({
                    url: 'http://169.254.169.254',
                    reachable: false,
                    probeUrl: 'http://169.254.169.254/mesh/ping',
                    latencyMs: 0,
                    error: 'Target not allowed by the network policy',
                })
            )
            const result = await service.checkMeshUrlReachability(
                'http://169.254.169.254'
            )
            expect(result.reachable).toBe(false)
            expect(result.error).toBe(
                'Target not allowed by the network policy'
            )
        })

        it('checkDomainReachability: the DNS-over-HTTPS name is URL-encoded, not interpolated', async () => {
            egress.fixedExternal.mockReturnValue(
                Effect.succeed(
                    body(
                        '{"Answer":[{"data":"203.0.113.1"},{"data":"not-an-ip"}]}'
                    )
                )
            )
            egress.external.mockReturnValue(Effect.fail(denied()))
            // a name that would inject a parameter if it were concatenated into the query
            const result = await service.checkDomainReachability(
                'nx-domain.invalid&type=TXT'
            )
            const url = new URL(
                (egress.fixedExternal.mock.calls[0]?.[0] as { url: string }).url
            )
            expect(url.hostname).toBe('dns.google')
            expect(url.searchParams.get('name')).toBe(
                'nx-domain.invalid&type=TXT'
            )
            expect(url.searchParams.get('type')).toBe('A')
            expect(result.resolvedIps).toEqual(['203.0.113.1'])
        })

        it('checkDomainReachability: a refused HTTP probe means not reachable, over https then http', async () => {
            egress.fixedExternal.mockReturnValue(Effect.fail(denied()))
            egress.external.mockReturnValue(Effect.fail(denied()))
            const result = await service.checkDomainReachability(
                'internal.corp.example'
            )
            expect(result.httpReachable).toBe(false)
            expect(egress.external).toHaveBeenCalledTimes(2)
            expect(
                egress.external.mock.calls.map(
                    ([req]) => (req as { url: string }).url
                )
            ).toEqual([
                'https://internal.corp.example',
                'http://internal.corp.example',
            ])
        })

        it('checkDomainReachability: any HTTP status counts as reachable', async () => {
            egress.fixedExternal.mockReturnValue(Effect.fail(denied()))
            egress.external.mockReturnValueOnce(
                Effect.succeed({ ...body(''), status: 404 })
            )
            const result =
                await service.checkDomainReachability('app.example.com')
            expect(result.httpReachable).toBe(true)
            expect(result.httpStatusCode).toBe(404)
        })
    })
})
