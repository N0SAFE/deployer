import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
    defaultIngressLanes,
    type PublicLane,
} from '@deployer/contracts-entities/entities/ingress/index'

import { NO_PUBLIC_EDGE } from './edge-provider.registry'
import {
    EdgeLaneInvalid,
    EdgeProviderAlreadyRegistered,
    EdgeProviderUnknown,
} from './edge.errors'
import {
    TEST_TUNNEL_ID,
    testEdgeRegistry,
    TestTunnelEdgeProvider,
} from './testing/edge-registry.fixture'

import type { EdgeContext } from './edge-provider'

const direct = (
    options: PublicLane['options'] = {},
    acknowledgedInboundPorts = true
): PublicLane => ({
    provider: 'direct',
    domain: 'apps.example.com',
    acknowledgedInboundPorts,
    options,
})

/** The typed refusal of an Effect that must fail. */
const refusal = <A, E>(effect: Effect.Effect<A, E>): E =>
    Effect.runSync(Effect.flip(effect))

describe('EdgeProviderRegistry', () => {
    it('lists the catalog with port-opening providers last', () => {
        const { registry } = testEdgeRegistry()
        expect(registry.descriptors().map((d) => d.id)).toEqual([
            TEST_TUNNEL_ID,
            'direct',
        ])
    })

    it('refuses a provider registered twice', () => {
        const { registry } = testEdgeRegistry()
        expect(
            Effect.runSync(
                Effect.flip(registry.register(new TestTunnelEdgeProvider()))
            )
        ).toBeInstanceOf(EdgeProviderAlreadyRegistered)
    })

    describe('normalize', () => {
        it('fills boolean defaults and drops nothing it was given', () => {
            const { registry } = testEdgeRegistry()
            expect(
                Effect.runSync(registry.normalize(direct())).options
            ).toEqual({ tls: true })
            expect(
                Effect.runSync(registry.normalize(direct({ tls: false })))
                    .options
            ).toEqual({ tls: false })
        })

        it("requires the operator's acknowledgement for a provider that opens ports", () => {
            const { registry } = testEdgeRegistry()
            expect(
                refusal(registry.normalize(direct({}, false))).message
            ).toMatch(/acknowledgedInboundPorts/)
        })

        it('never records an acknowledgement a provider does not need', () => {
            const { registry } = testEdgeRegistry()
            const lane = Effect.runSync(
                registry.normalize({
                    provider: TEST_TUNNEL_ID,
                    domain: 'a.example.com',
                    acknowledgedInboundPorts: true,
                    options: { account: 'x' },
                })
            )
            expect(lane.acknowledgedInboundPorts).toBe(false)
        })

        it('rejects unknown providers, unknown options, wrong types and missing required options', () => {
            const { registry } = testEdgeRegistry()
            expect(
                refusal(registry.normalize({ ...direct(), provider: 'nope' }))
            ).toBeInstanceOf(EdgeProviderUnknown)
            expect(
                refusal(registry.normalize(direct({ port: 8080 }))).message
            ).toMatch(/does not take/)
            expect(
                refusal(registry.normalize(direct({ tls: 'yes' }))).message
            ).toMatch(/true or false/)
            const missing = refusal(
                registry.normalize({
                    provider: TEST_TUNNEL_ID,
                    domain: 'a.example.com',
                    acknowledgedInboundPorts: false,
                    options: {},
                })
            )
            expect(missing).toBeInstanceOf(EdgeLaneInvalid)
            expect(missing.message).toMatch(/required/)
        })
    })

    describe('ingressPlan', () => {
        it('publishes nothing without a public lane, or for an unknown provider', () => {
            const { registry } = testEdgeRegistry()
            expect(registry.ingressPlan(defaultIngressLanes())).toEqual(
                NO_PUBLIC_EDGE
            )
            expect(
                registry.ingressPlan({
                    ...defaultIngressLanes(),
                    public: { ...direct(), provider: 'gone' },
                })
            ).toEqual(NO_PUBLIC_EDGE)
        })

        it('publishes :80/:443 for direct with TLS, :80 only without', () => {
            const { registry } = testEdgeRegistry()
            expect(
                registry.ingressPlan({
                    ...defaultIngressLanes(),
                    public: direct({ tls: true }),
                })
            ).toEqual({
                publishedPorts: [
                    { published: 80, entrypoint: 'public' },
                    { published: 443, entrypoint: 'public-tls' },
                ],
                tls: 'acme',
            })
            expect(
                registry.ingressPlan({
                    ...defaultIngressLanes(),
                    public: direct({ tls: false }),
                }).publishedPorts
            ).toHaveLength(1)
        })

        it('publishes no port that was not acknowledged, even from a hand-edited setting', () => {
            const { registry } = testEdgeRegistry()
            expect(
                registry.ingressPlan({
                    ...defaultIngressLanes(),
                    public: direct({ tls: true }, false),
                }).publishedPorts
            ).toEqual([])
        })
    })

    it('names the DNS accounts the public lane depends on', () => {
        const { registry } = testEdgeRegistry()
        const lanes = {
            ...defaultIngressLanes(),
            public: {
                provider: TEST_TUNNEL_ID,
                domain: 'a.example.com',
                acknowledgedInboundPorts: false,
                options: { account: 'acc-7' },
            },
        }
        expect(registry.accountsInUse(lanes)).toEqual(['acc-7'])
        expect(registry.accountsInUse(defaultIngressLanes())).toEqual([])
    })
})

describe('DirectEdgeProvider', () => {
    const ctx = (nodes: EdgeContext['nodes']): EdgeContext => ({
        lane: direct({ tls: true }),
        ingressTarget: 'http://deployer-traefik:8002',
        nodes,
        resourceName: 'deployer-stack',
    })
    const provider = () => testEdgeRegistry().registry.find('direct')!

    it('points the wildcard at every declared public IP — never at a hostname', async () => {
        const records = await Effect.runPromise(provider().dnsRecords(
            ctx([
                {
                    nodeId: 'a',
                    publicAddress: '203.0.113.5',
                    addressKind: 'ip',
                },
                {
                    nodeId: 'b',
                    publicAddress: '203.0.113.4',
                    addressKind: 'ip',
                },
                {
                    nodeId: 'c',
                    publicAddress: 'node-c.example.net',
                    addressKind: 'hostname',
                },
            ])
        ))
        expect(records).toEqual([
            {
                name: '*.apps.example.com',
                type: 'A',
                contents: ['203.0.113.4', '203.0.113.5'],
                proxied: false,
                preferredAccountId: null,
            },
        ])
    })

    it('is not provisioned, and offers no join path, until a node declares a public IP', async () => {
        const edge = provider()
        const status = await Effect.runPromise(edge.status(ctx([])))
        expect(status).toMatchObject({ provisioned: false, health: 'down' })
        expect(edge.joinPath(ctx([]), status).available).toBe(false)
        expect(await Effect.runPromise(edge.dnsRecords(ctx([])))).toEqual([])
    })

    it('runs no connector', async () => {
        expect(await Effect.runPromise(provider().connector(ctx([])))).toBeNull()
    })
})
