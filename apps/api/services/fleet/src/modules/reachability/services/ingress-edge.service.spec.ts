import { Cause, Effect, Exit } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'
import { provideTo } from '@deployer/effect-core'
import type {
    NodeDoorClient,
    NodeDoorStatus,
    NodeDoorView,
} from '@deployer/mesh-client'
import type { EnvService } from '@deployer/shared/config/env/env.module'
import type { EdgeContext } from '@deployer/shared/core/modules/edge/edge-provider'
import {
    TEST_TUNNEL_ID,
    testEdgeRegistry,
} from '@deployer/shared/core/modules/edge/testing/edge-registry.fixture'
import { EnvHostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'
import type { IngressLanesServiceShape } from '@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service'
import type { NodeNetworkConfigRepositoryShape } from '@deployer/shared/core/modules/reachability/repositories/node-network-config.repository'
import { makePublicEdgeService } from '@deployer/shared/core/modules/reachability/services/public-edge.service'
import type { TraefikConfigRefresherShape } from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'

import { DnsProviderRegistryService } from '@/modules/providers/dns/shared/dns-provider-registry.service'

import {
    EdgeProvidersPort,
    HostnamesPort,
    IngressLanesPort,
    NodeAgentPort,
    PublicEdgePort,
    TraefikRefresherPort,
} from '../reachability.ports'

import { EdgeDnsService } from './edge-dns.service'
import { IngressEdgeService } from './ingress-edge.service'

import type { EdgeDnsServiceShape } from './edge-dns.service'

/** Run an Effect and reject with the ORIGINAL failure, so `toThrow(/text/)` reads the real message. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

/** The original failure, for asserting on its kind as well as its message. */
async function failure<A, E>(
    effect: Effect.Effect<A, E>
): Promise<E & { kind?: string; message?: string }> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) throw new Error('expected the effect to fail')
    return Cause.squash(exit.cause) as E & { kind?: string; message?: string }
}

const HANDSHAKE = 1_700_000_000_000

const overlay = (meshAddress: string, endpoint: string) => ({
    wireguardKey: `wg-${meshAddress}`,
    meshAddress,
    endpoint,
    listenPort: 51_820,
})

/** The roster as the new agent's door answers it: node id, where its agent answers, its overlay when it has one. */
const doorView: NodeDoorView = {
    self: {
        nodeId: 'm1',
        address: '10.0.0.1:4318',
        labels: {},
        overlay: overlay('100.88.0.1', '198.51.100.1:51820'),
    },
    agents: [
        {
            nodeId: 'm1',
            address: '10.0.0.1:4318',
            labels: {},
            overlay: overlay('100.88.0.1', '198.51.100.1:51820'),
        },
        {
            nodeId: 'm2',
            address: '10.0.0.2:4318',
            labels: {},
            overlay: overlay('100.88.0.2', '198.51.100.2:51820'),
        },
        // A node registered before it had an overlay: address yes, kernel peer and handshake no.
        { nodeId: 'm3', address: '10.0.0.3:4318', labels: {}, overlay: null },
    ],
}

const doorStatus: NodeDoorStatus = {
    agentId: 'agent-1',
    swarmId: 'swarm-1',
    load: { eventLoopLagMs: 0, bytesPerSecond: 0, openStreams: 0 },
    interfaceUp: true,
    meshAddress: '100.88.0.1',
    listenPort: 51_820,
    peers: [
        {
            nodeId: 'm2',
            meshAddress: '100.88.0.2',
            endpoint: '198.51.100.2:51820',
            latestHandshakeAt: HANDSHAKE,
        },
    ],
}

function setup(initial: IngressLanes = defaultIngressLanes()) {
    let lanes = initial
    const order: string[] = []
    const lanesService = {
        getLanes: vi.fn(() => Effect.succeed(lanes)),
        setLanes: vi.fn((next: IngressLanes) => {
            order.push(`setLanes:${next.public?.provider ?? 'none'}`)
            lanes = next
            return Effect.succeed(next)
        }),
    } as unknown as IngressLanesServiceShape
    const { registry, tunnel } = testEdgeRegistry()
    tunnel.provisioned = true
    vi.spyOn(tunnel, 'provision').mockImplementation((ctx: EdgeContext) => {
        order.push(`provision:${ctx.lane.provider}`)
        return Effect.void
    })
    vi.spyOn(tunnel, 'teardown').mockImplementation(() => {
        order.push('teardown:test-tunnel')
        return Effect.void
    })
    vi.spyOn(tunnel, 'dnsRecords').mockImplementation(() =>
        Effect.succeed(
            lanes.public?.provider === TEST_TUNNEL_ID
                ? [
                      {
                          name: `*.${lanes.public.domain}`,
                          type: 'CNAME' as const,
                          contents: ['t.example'],
                          proxied: true,
                          preferredAccountId: 'acc-1',
                      },
                  ]
                : []
        )
    )
    const nodeConfigs = {
        list: vi.fn(() => Effect.succeed([])),
    } as unknown as NodeNetworkConfigRepositoryShape
    const env = { get: vi.fn(() => '') } as unknown as EnvService
    const publicEdge = makePublicEdgeService({
        registry,
        nodeConfigs,
        prefix: '',
    })
    const dns = {
        results: vi.fn(() => Effect.succeed([])),
        reconcile: vi.fn(() => Effect.succeed([])),
        removeRecords: vi.fn(() => Effect.void),
    } as unknown as EdgeDnsServiceShape
    const mesh = {
        status: vi.fn((): Promise<NodeDoorStatus | null> =>
            Promise.resolve(doorStatus)
        ),
        view: vi.fn((): Promise<NodeDoorView | null> =>
            Promise.resolve(doorView)
        ),
        blockNode: vi.fn(() => Promise.resolve(['m2'] as readonly string[])),
    } as unknown as NodeDoorClient
    const refresher = {
        refresh: vi.fn(),
    } as unknown as TraefikConfigRefresherShape
    // The fakes need nothing from the context beyond what is provided here, so the DNS registry's
    // adapter requirements are discharged.
    const service = provideTo(
        IngressEdgeService.live,
        (effect) =>
            effect.pipe(
                Effect.provideService(IngressLanesPort, lanesService as never),
                Effect.provideService(EdgeProvidersPort, registry as never),
                Effect.provideService(PublicEdgePort, publicEdge as never),
                Effect.provideService(EdgeDnsService, dns as never),
                // The fake DNS service reads no registry; the context only has to hold the tag.
                Effect.provideService(DnsProviderRegistryService, {} as never),
                Effect.provideService(NodeAgentPort, mesh as never),
                Effect.provideService(
                    HostnamesPort,
                    new EnvHostnameService(env) as never
                ),
                Effect.provideService(TraefikRefresherPort, refresher as never)
            ) as Effect.Effect<unknown>
    )
    return {
        service,
        lanesService,
        tunnel,
        dns,
        mesh,
        refresher,
        order,
        getLanes: () => lanes,
    }
}

const tunnelInput = {
    provider: TEST_TUNNEL_ID,
    domain: 'apps.example.com',
    options: { account: 'acc-1' },
}

describe('IngressEdgeService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('getState', () => {
        it('reports a local-only install with the provider catalog and no active edge', async () => {
            const state = await run(setup().service.getState())
            expect(state.edge.active).toBeNull()
            expect(
                state.edge.providers.map((provider) => provider.id).sort()
            ).toEqual(['direct', TEST_TUNNEL_ID])
            expect(state.exposure.reachableFromInternet).toBe(false)
            expect(state.consoleUrls.public).toBeNull()
        })

        it("maps the door's roster to members: overlay address, declared endpoint, handshake", async () => {
            const { mesh } = await run(setup().service.getState())
            expect(mesh.available).toBe(true)
            expect(mesh.members.find((m) => m.self)).toMatchObject({
                memberId: 'm1',
                name: 'm1',
                kind: 'node',
                state: 'active',
                address: '100.88.0.1',
                link: {
                    path: 'self',
                    endpoint: '198.51.100.1:51820',
                    latestHandshakeAt: null,
                },
            })
            expect(mesh.members.find((m) => m.memberId === 'm2')).toMatchObject(
                {
                    self: false,
                    labels: {},
                    address: '100.88.0.2',
                    endpoints: [{ kind: 'declared', address: '10.0.0.2:4318' }],
                    link: {
                        path: 'direct',
                        endpoint: '198.51.100.2:51820',
                        latestHandshakeAt: new Date(HANDSHAKE).toISOString(),
                    },
                }
            )
            // A node with no overlay and no handshake is listed as waiting, with no invented endpoint.
            expect(mesh.members.find((m) => m.memberId === 'm3')?.link).toEqual(
                { path: 'passive', endpoint: null, latestHandshakeAt: null }
            )
        })

        it('leaves what the door cannot answer null or empty, never fabricated', async () => {
            const { mesh } = await run(setup().service.getState())
            expect(mesh.clusterId).toBeNull()
            expect(mesh.cidr).toBeNull()
            expect(mesh.doors).toEqual([])
            expect(mesh.lastGossipAt).toBeNull()
            expect(mesh.lastError).toBeNull()
            expect(mesh.address).toBe('100.88.0.1')
            expect(mesh.listenPort).toBe(51_820)
            expect(mesh.interfaceUp).toBe(true)
        })

        it('reports no mesh when the node has no new agent, instead of inventing one', async () => {
            const { service, mesh } = setup()
            vi.mocked(mesh.status).mockResolvedValue(null)
            vi.mocked(mesh.view).mockResolvedValue(null)
            const { mesh: view } = await run(service.getState())
            expect(view.available).toBe(false)
            expect(view.members).toEqual([])
            expect(view.lastError).toMatch(/did not answer/)
        })

        it('takes the public join path from the active provider', async () => {
            const { service } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            const state = await run(service.getState())
            expect(
                state.entryPoints.points.find(
                    (point) => point.kind === 'public'
                )
            ).toMatchObject({ via: 'Test Tunnel', available: true })
        })
    })

    describe('update', () => {
        it('provisions the new edge BEFORE the lanes name it', async () => {
            const { service, order, refresher } = setup()
            await run(service.update({ public: tunnelInput }))
            expect(order).toEqual([
                `provision:${TEST_TUNNEL_ID}`,
                `setLanes:${TEST_TUNNEL_ID}`,
            ])
            expect(refresher.refresh).toHaveBeenCalled()
        })

        it('leaves the lanes untouched when the new edge cannot be provisioned', async () => {
            const { service, tunnel, lanesService } = setup()
            vi.mocked(tunnel.provision).mockReturnValueOnce(
                Effect.fail(new Error('account refused'))
            )
            await expect(
                run(service.update({ public: tunnelInput }))
            ).rejects.toThrow('account refused')
            expect(lanesService.setLanes).not.toHaveBeenCalled()
        })

        it('switches providers new-first, old-last', async () => {
            const { service, order } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            await run(
                service.update({
                    public: {
                        provider: 'direct',
                        domain: 'apps.example.com',
                        acknowledgedInboundPorts: true,
                    },
                })
            )
            expect(order).toEqual(['setLanes:direct', 'teardown:test-tunnel'])
        })

        it("still turns the public lane off when the old edge's provider is unreachable", async () => {
            const { service, tunnel, getLanes } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            vi.mocked(tunnel.teardown).mockReturnValueOnce(
                Effect.fail(new Error('provider down'))
            )
            await run(service.update({ public: null }))
            expect(getLanes().public).toBeNull()
        })

        it("refuses an inbound edge without the operator's acknowledgement", async () => {
            const { service, lanesService } = setup()
            await expect(
                run(
                    service.update({
                        public: {
                            provider: 'direct',
                            domain: 'apps.example.com',
                        },
                    })
                )
            ).rejects.toThrow(/acknowledgedInboundPorts/)
            expect(lanesService.setLanes).not.toHaveBeenCalled()
        })

        it('refuses options the provider does not declare, and missing required ones', async () => {
            const { service } = setup()
            await expect(
                run(
                    service.update({
                        public: {
                            ...tunnelInput,
                            options: { account: 'a', bogus: true },
                        },
                    })
                )
            ).rejects.toThrow(/bogus/)
            await expect(
                run(service.update({ public: { ...tunnelInput, options: {} } }))
            ).rejects.toThrow(/Account/)
        })

        it("keeps the provider's options when only the domain changes", async () => {
            const { service, getLanes } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            await run(
                service.update({
                    public: {
                        provider: TEST_TUNNEL_ID,
                        domain: 'new.example.com',
                    },
                })
            )
            expect(getLanes().public).toMatchObject({
                domain: 'new.example.com',
                options: { account: 'acc-1' },
            })
        })

        it('removes the DNS record of a domain the edge no longer serves', async () => {
            const { service, dns } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            await run(
                service.update({
                    public: {
                        provider: TEST_TUNNEL_ID,
                        domain: 'new.example.com',
                    },
                })
            )
            expect(dns.removeRecords).toHaveBeenCalledWith(
                '*.apps.example.com',
                'acc-1'
            )
            expect(dns.reconcile).toHaveBeenCalledWith([
                expect.objectContaining({
                    lane: 'public',
                    name: '*.new.example.com',
                }),
            ])
        })

        it('enables the private lane without touching the public edge', async () => {
            const { service, tunnel, getLanes } = setup()
            await run(
                service.update({
                    private: { enabled: true, exposeOnLan: true },
                })
            )
            expect(getLanes().private).toEqual({
                enabled: true,
                domain: 'deployer.internal',
                exposeOnLan: true,
            })
            expect(tunnel.provision).not.toHaveBeenCalled()
        })

        it("plans the private lane's A records from the nodes' overlay addresses only", async () => {
            const { service, dns } = setup({
                ...defaultIngressLanes(),
                private: {
                    enabled: true,
                    domain: 'deployer.example.com',
                    exposeOnLan: false,
                },
            })
            await run(service.reconcileDns())
            expect(dns.reconcile).toHaveBeenCalledWith([
                expect.objectContaining({
                    lane: 'private',
                    type: 'A',
                    contents: ['100.88.0.1', '100.88.0.2'],
                }),
            ])
        })
    })

    describe('teardownPublicEdge', () => {
        it('tears the provider down, then turns the lane off and drops its records', async () => {
            const { service, order, dns, getLanes } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            await run(service.teardownPublicEdge())
            expect(order).toEqual(['teardown:test-tunnel', 'setLanes:none'])
            expect(getLanes().public).toBeNull()
            expect(dns.removeRecords).toHaveBeenCalledWith(
                '*.apps.example.com',
                'acc-1'
            )
        })

        it('reports a provider failure instead of pretending the edge is gone', async () => {
            const { service, tunnel, lanesService } = setup({
                ...defaultIngressLanes(),
                public: { ...tunnelInput, acknowledgedInboundPorts: false },
            })
            vi.mocked(tunnel.teardown).mockReturnValueOnce(
                Effect.fail(new Error('provider down'))
            )
            await expect(run(service.teardownPublicEdge())).rejects.toThrow(
                'provider down'
            )
            expect(lanesService.setLanes).not.toHaveBeenCalled()
        })
    })

    describe('revokeMeshMember', () => {
        it('blocks the member through the node door', async () => {
            const { service, mesh } = setup()

            await run(service.revokeMeshMember('m2', 'decommissioned'))

            expect(mesh.blockNode).toHaveBeenCalledWith('m2')
        })

        it('reports an agent that stopped answering mid-revocation, instead of claiming it revoked', async () => {
            const { service, mesh } = setup()
            vi.mocked(mesh.blockNode).mockResolvedValueOnce(null)

            const error = await failure(
                service.revokeMeshMember('m2', 'decommissioned')
            )

            expect(error.kind).toBe('dependency_missing')
            expect(error.message).toMatch(/did not answer/)
        })

        it('refuses to revoke the node answering, and unknown members', async () => {
            const { service } = setup()
            await expect(
                run(service.revokeMeshMember('m1', 'x'))
            ).rejects.toThrow(/cannot revoke itself/)
            await expect(
                run(service.revokeMeshMember('m9', 'x'))
            ).rejects.toThrow(/No mesh member/)
        })

        it('reports the missing agent rather than a revocation nobody performed', async () => {
            const { service, mesh } = setup()
            vi.mocked(mesh.view).mockResolvedValue(null)
            await expect(
                run(service.revokeMeshMember('m2', 'x'))
            ).rejects.toThrow(/did not answer/)
        })
    })
})
