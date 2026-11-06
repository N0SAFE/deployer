import { Cause, Context, Effect, Exit } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicLane } from '@deployer/contracts-entities/entities/ingress/index'
import { provideTo } from '@deployer/effect-core'
import type { EffectHostShape } from '@deployer/nest-effect'
import type { EdgeContext } from '@deployer/shared/core/modules/edge/edge-provider'
import { makeEdgeProviderRegistry } from '@deployer/shared/core/modules/edge/edge-provider.registry'
import {
    EdgeStateStore,
    type EdgeStateStoreShape,
} from '@deployer/shared/core/modules/edge/edge-state.store'

import {
    CloudflareTunnelService,
    type CloudflareTunnelServiceShape,
} from '../../dns/cloudflare/services/cloudflare-tunnel.service'

import { CloudflaredSettings } from './cloudflare-tunnel.edge-ports'
import {
    CLOUDFLARE_TUNNEL_EDGE_ID,
    CloudflareTunnelEdge,
    edgeProviderOver,
} from './cloudflare-tunnel.edge-provider'
import { FleetInvalid } from '../../../../core/fleet.errors'

const lane = (account: string, domain = 'apps.example.com'): PublicLane => ({
    provider: CLOUDFLARE_TUNNEL_EDGE_ID,
    domain,
    acknowledgedInboundPorts: false,
    options: { account },
})

const ctx = (l: PublicLane): EdgeContext => ({
    lane: l,
    ingressTarget: 'http://deployer-traefik:8002',
    nodes: [],
    resourceName: 'deployer-stack',
})

/** The service over fakes for its three collaborators, and the registered Promise adapter over the same world. */
function setup(initial: unknown = null) {
    let state: unknown = initial
    const store = {
        read: vi.fn(() => Effect.succeed(state)),
        write: vi.fn((_id: string, _schema: unknown, value: unknown) => {
            state = value
            return Effect.succeed(value)
        }),
        clear: vi.fn(() => {
            state = null
            return Effect.void
        }),
    } as unknown as EdgeStateStoreShape
    const tunnels = {
        createTunnel: vi.fn(() =>
            Effect.succeed({ tunnel: { id: 'tun-new' }, token: 'tok-new' })
        ),
        configureIngress: vi.fn(() => Effect.void),
        deleteTunnel: vi.fn(() => Effect.succeed(true)),
        getTunnelHealth: vi.fn(() =>
            Effect.succeed({
                status: 'healthy',
                checkedAt: '',
                connections: 2,
                error: null,
            })
        ),
    } as unknown as CloudflareTunnelServiceShape
    const settings = {
        image: () => 'cloudflare/cloudflared:2025.1.0',
        replicas: () => 2,
    }
    const world = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
        effect.pipe(
            Effect.provideService(CloudflareTunnelEdge, new CloudflareTunnelEdge.live()),
            Effect.provideService(CloudflareTunnelService, tunnels),
            Effect.provideService(EdgeStateStore, store),
            Effect.provideService(CloudflaredSettings, settings)
        ) as Effect.Effect<A, E>
    const edge = provideTo(new CloudflareTunnelEdge.live(), (effect) => world(effect))
    // The host the registered adapter takes its context from: the app's, which holds every service over the same fakes.
    const appContext = Context.make(CloudflareTunnelEdge, new CloudflareTunnelEdge.live()).pipe(
        Context.add(CloudflareTunnelService, tunnels),
        Context.add(EdgeStateStore, store),
        Context.add(CloudflaredSettings, settings)
    )
    const host = {
        context: () => Promise.resolve(appContext),
    } as unknown as EffectHostShape
    const registry = makeEdgeProviderRegistry()
    Effect.runSync(registry.register(edgeProviderOver(host)))
    return { edge, registry, tunnels, store, getState: () => state, provider: registry.find(CLOUDFLARE_TUNNEL_EDGE_ID)! }
}

const existing = {
    accountId: 'acc-1',
    tunnelId: 'tun-1',
    token: 'tok-1',
    wildcard: '*.apps.example.com',
}

describe('CloudflareTunnelEdge', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('registers itself as an outbound tunnel edge that opens no port', () => {
        const { registry } = setup()
        const descriptor = registry.find(CLOUDFLARE_TUNNEL_EDGE_ID)!.descriptor
        expect(descriptor).toMatchObject({
            kind: 'tunnel',
            opensInboundPorts: false,
            usesProviderAccount: true,
        })
        expect(
            registry.ingressPlan({
                entryPort: 80,
                private: {
                    enabled: false,
                    domain: 'd.internal',
                    exposeOnLan: false,
                },
                public: lane('a'),
                consoleVisibility: 'public',
            })
        ).toEqual({
            publishedPorts: [],
            tls: 'edge',
        })
    })

    it('creates ONE stack tunnel and routes the wildcard to Traefik — no DNS here', async () => {
        const { edge, tunnels, getState } = setup()
        await Effect.runPromise(edge.provision(ctx(lane('acc-1'))))
        expect(tunnels.createTunnel).toHaveBeenCalledWith('acc-1', {
            name: 'deployer-stack',
        })
        expect(tunnels.configureIngress).toHaveBeenCalledWith(
            'acc-1',
            'tun-new',
            '*.apps.example.com',
            'http://deployer-traefik:8002'
        )
        expect(getState()).toEqual({
            accountId: 'acc-1',
            tunnelId: 'tun-new',
            token: 'tok-new',
            wildcard: '*.apps.example.com',
        })
    })

    it('reuses the tunnel on re-provision and only re-routes a new domain', async () => {
        const { edge, tunnels, getState } = setup(existing)
        await Effect.runPromise(edge.provision(ctx(lane('acc-1', 'new.example.com'))))
        expect(tunnels.createTunnel).not.toHaveBeenCalled()
        expect(tunnels.configureIngress).toHaveBeenCalledWith(
            'acc-1',
            'tun-1',
            '*.new.example.com',
            'http://deployer-traefik:8002'
        )
        expect(getState()).toMatchObject({
            tunnelId: 'tun-1',
            wildcard: '*.new.example.com',
        })
    })

    it('deletes the old tunnel before moving to another account', async () => {
        const { edge, tunnels } = setup(existing)
        await Effect.runPromise(edge.provision(ctx(lane('acc-2'))))
        expect(tunnels.deleteTunnel).toHaveBeenCalledWith('acc-1', 'tun-1')
        expect(tunnels.createTunnel).toHaveBeenCalledWith('acc-2', {
            name: 'deployer-stack',
        })
    })

    it('runs a connector with the token in the environment, never in argv', async () => {
        const { edge } = setup(existing)
        const spec = await Effect.runPromise(edge.connector(ctx(lane('acc-1'))))
        expect(spec).toMatchObject({ env: ['TUNNEL_TOKEN=tok-1'], replicas: 2 })
        expect(JSON.stringify([spec?.command, spec?.args])).not.toContain(
            'tok-1'
        )
        // A tunnel on another account than the lane names is not ours to run.
        expect(await Effect.runPromise(edge.connector(ctx(lane('acc-2'))))).toBeNull()
    })

    it("asks for a proxied wildcard CNAME on the tunnel's own account", async () => {
        const { edge } = setup(existing)
        expect(await Effect.runPromise(edge.dnsRecords(ctx(lane('acc-1'))))).toEqual([
            {
                name: '*.apps.example.com',
                type: 'CNAME',
                contents: ['tun-1.cfargotunnel.com'],
                proxied: true,
                preferredAccountId: 'acc-1',
            },
        ])
    })

    it('reports health and connections, and joinability only once provisioned', async () => {
        const { edge, provider } = setup(existing)
        const status = await Effect.runPromise(edge.status(ctx(lane('acc-1'))))
        expect(status).toMatchObject({ provisioned: true, health: 'healthy' })
        expect(provider.joinPath(ctx(lane('acc-1')), status)).toMatchObject({
            available: true,
            sources: 2,
            target: 'https://api.apps.example.com',
        })
        const empty = setup()
        const none = await Effect.runPromise(empty.edge.status(ctx(lane('acc-1'))))
        expect(none.provisioned).toBe(false)
        expect(empty.provider.joinPath(ctx(lane('acc-1')), none).available).toBe(false)
    })

    it('tears down provider-first, then forgets', async () => {
        const { edge, tunnels, store } = setup(existing)
        await Effect.runPromise(edge.teardown())
        expect(tunnels.deleteTunnel).toHaveBeenCalledWith('acc-1', 'tun-1')
        expect(store.clear).toHaveBeenCalled()
        vi.mocked(tunnels.deleteTunnel).mockClear()
        await Effect.runPromise(edge.teardown())
        expect(tunnels.deleteTunnel).not.toHaveBeenCalled()
    })

    it('forgets the stack tunnel only when the deleted one is it', async () => {
        const { edge, store } = setup(existing)
        expect(await Effect.runPromise(edge.forgetDeletedTunnel('acc-1', 'other'))).toBe(false)
        expect(store.clear).not.toHaveBeenCalled()
        expect(await Effect.runPromise(edge.forgetDeletedTunnel('acc-1', 'tun-1'))).toBe(true)
        expect(store.clear).toHaveBeenCalled()
    })

    it('refuses a lane that names no Cloudflare account, as a typed error, and touches nothing', async () => {
        const { edge, tunnels, store } = setup()
        const noAccount = { ...lane('x'), options: {} }

        const exit = await Effect.runPromiseExit(edge.provision(ctx(noAccount)))

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(FleetInvalid)
        expect(tunnels.createTunnel).not.toHaveBeenCalled()
        expect(store.write).not.toHaveBeenCalled()
    })

    it('lets the registered provider provision on the app context, and fail with the original error', async () => {
        const ok = setup()
        await Effect.runPromise(ok.provider.provision(ctx(lane('acc-1'))))
        expect(ok.getState()).toMatchObject({ tunnelId: 'tun-new' })

        const boom = new Error('cloudflare down')
        const failing = setup()
        vi.mocked(failing.tunnels.createTunnel).mockImplementationOnce(
            () => Effect.fail(boom) as never
        )
        const exit = await Effect.runPromiseExit(failing.provider.provision(ctx(lane('acc-1'))))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(boom)
    })
})
