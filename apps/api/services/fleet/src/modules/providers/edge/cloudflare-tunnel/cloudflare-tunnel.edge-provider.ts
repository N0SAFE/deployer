/**
 * Cloudflare Tunnel — the public lane carried by connectors that dial OUT.
 *
 * ONE tunnel per stack, with a single wildcard rule `*.<domain> → Traefik public`:
 * onboarding an app never touches Cloudflare, because Traefik decides which
 * service a Host belongs to. High availability comes from connector REPLICAS
 * (Cloudflare balances up to 25 connectors on one tunnel), not from more tunnels —
 * so the Cloudflare side stays fixed as the fleet grows.
 *
 * No node opens a port and no node needs a public address: the connectors are
 * clients. Cloudflare terminates TLS.
 *
 * State (`edge.cloudflare-tunnel`): the tunnel id, the DNS account it lives on and
 * the connector token. The token replicates to every member (any node may run a
 * connector) and never reaches a client.
 */

import { Context, Effect } from 'effect'
import z from 'zod/v4'

import type {
    EdgeProviderDescriptor,
    EdgeStatus,
    PublicJoinPath,
    PublicLane,
} from '@deployer/contracts-entities/entities/ingress/index'
import type { EffectHostShape } from '@deployer/nest-effect'
import type {
    EdgeConnectorSpec,
    EdgeContext,
    EdgeDnsRecord,
    EdgeIngressPlan,
    EdgeProvider,
} from '@deployer/shared/core/modules/edge/edge-provider'
import {
    EdgeStateStore,
    type EdgeStateStoreShape,
} from '@deployer/shared/core/modules/edge/edge-state.store'

import { FleetInvalid } from '../../../../core/fleet.errors'
import {
    CloudflareTunnelService,
    type CloudflareTunnelServiceShape,
} from '../../dns/cloudflare/services/cloudflare-tunnel.service'

import { CloudflaredSettings } from './cloudflare-tunnel.edge-ports'

export const CLOUDFLARE_TUNNEL_EDGE_ID = 'cloudflare-tunnel'

/** The lane option naming the Cloudflare account (a DNS provider app) the tunnel lives on. */
const ACCOUNT_OPTION = 'account'

const DESCRIPTOR: EdgeProviderDescriptor = {
    id: CLOUDFLARE_TUNNEL_EDGE_ID,
    label: 'Cloudflare Tunnel',
    kind: 'tunnel',
    summary:
        'Connectors dial out to Cloudflare — no inbound port, no public IP.',
    description:
        'One tunnel for the whole stack routes *.<domain> to Traefik. Connector replicas run on the cluster and dial out to Cloudflare, which terminates TLS. No node opens a port or needs a public address; requires a Cloudflare account with tunnel management enabled.',
    opensInboundPorts: false,
    usesProviderAccount: true,
    servesHttps: true,
    options: [
        {
            type: 'dns-account',
            key: ACCOUNT_OPTION,
            label: 'Cloudflare account',
            description:
                'The Cloudflare app the tunnel is created on. It needs tunnel management enabled.',
            required: true,
            providerType: 'cloudflare',
            requiredFeature: 'tunnelManagement',
        },
    ],
}

const stateSchema = z.object({
    accountId: z.string(),
    tunnelId: z.string(),
    token: z.string(),
    /** `*.<domain>` the tunnel routes. */
    wildcard: z.string(),
})
type TunnelState = z.output<typeof stateSchema>

/** The Cloudflare account the lane names: a lane without one cannot have a tunnel. */
const accountOf = (lane: PublicLane) =>
    Effect.gen(function* () {
        const value = lane.options[ACCOUNT_OPTION]
        if (typeof value !== 'string' || value === '') {
            return yield* new FleetInvalid({
                reason: 'Cloudflare Tunnel needs a Cloudflare account',
            })
        }
        return value
    })

/** Static: connectors reach Traefik over the overlay, and Cloudflare serves HTTPS. */
const ingressPlan = (): EdgeIngressPlan => ({ publishedPorts: [], tls: 'edge' })

/** Whether, and how, a node that is not a member yet can join through this edge. Pure. */
const joinPathOf = (ctx: EdgeContext, status: EdgeStatus): PublicJoinPath => ({
    via: DESCRIPTOR.label,
    available: status.provisioned,
    target: `https://api.${ctx.lane.domain}`,
    hostHeader: null,
    sources: status.provisioned
        ? Number(
              status.facts.find((fact) => fact.label === 'Connections')?.value ??
                  0
          )
        : 0,
    detail: status.provisioned
        ? 'A node anywhere dials the public domain; a connector carries it in. No node opens a port and the joiner needs no public address.'
        : (status.detail ?? 'The tunnel is not created yet.'),
})

type TunnelApi = CloudflareTunnelServiceShape
type StoreApi = EdgeStateStoreShape

/** What running the edge needs from the context: its three collaborators, and whatever the tunnel API itself needs. */
type EdgeNeeds =
    | CloudflareTunnelService
    | EdgeStateStore
    | CloudflaredSettings
    // Every tunnel operation needs the same services, so one of them stands for all.
    | Effect.Services<ReturnType<TunnelApi['createTunnel']>>

/** A lane without an account, a state that cannot be stored, or whatever the tunnel service failed with (it does not type its errors). */
type EdgeFailure = unknown

const readState = (store: StoreApi) => store.read(CLOUDFLARE_TUNNEL_EDGE_ID, stateSchema)

/** The state, but only when it belongs to the account the lane names. */
const stateForLane = (store: StoreApi, lane: PublicLane) =>
    Effect.gen(function* () {
        const account = yield* accountOf(lane)
        const current = yield* readState(store)
        return current !== null && current.accountId === account ? current : null
    })

/** Provider first: forgetting the id first would orphan a tunnel nobody can name. */
const teardownWith = (tunnels: TunnelApi, store: StoreApi) =>
    Effect.gen(function* () {
        const current = yield* readState(store)
        if (current === null) return
        yield* tunnels.deleteTunnel(current.accountId, current.tunnelId)
        yield* store.clear(CLOUDFLARE_TUNNEL_EDGE_ID)
        yield* Effect.logInfo(
            `Deleted stack tunnel ${current.tunnelId} (account ${current.accountId})`
        )
    })

export type CloudflareTunnelEdgeShape = {
    /** Make the provider side exist and route `*.<domain>` to the ingress target. Idempotent. */
    readonly provision: (ctx: EdgeContext) => Effect.Effect<void, EdgeFailure, EdgeNeeds>
    /** Remove everything the provider created, and its state. Idempotent. */
    readonly teardown: () => Effect.Effect<void, EdgeFailure, EdgeNeeds>
    /** The connector the cluster must run, or null when the tunnel is not this lane's. */
    readonly connector: (
        ctx: EdgeContext
    ) => Effect.Effect<EdgeConnectorSpec | null, EdgeFailure, EdgeNeeds>
    readonly dnsRecords: (
        ctx: EdgeContext
    ) => Effect.Effect<EdgeDnsRecord[], EdgeFailure, EdgeNeeds>
    readonly status: (ctx: EdgeContext) => Effect.Effect<EdgeStatus, EdgeFailure, EdgeNeeds>
    /** The wildcard the stack tunnel routes, when `tunnelId` on `accountId` is it (called by the tunnels page). */
    readonly stackWildcard: (
        accountId: string,
        tunnelId: string
    ) => Effect.Effect<string | null, EdgeFailure, EdgeNeeds>
    /** Forget the stack tunnel after it was deleted from the tunnels page. True when it was the stack's. */
    readonly forgetDeletedTunnel: (
        accountId: string,
        tunnelId: string
    ) => Effect.Effect<boolean, EdgeFailure, EdgeNeeds>
}

/**
 * The stack tunnel, as an Effect service over the tunnel API, the edge state store and the connector settings.
 *
 * Every method is an Effect that fails with its own typed errors (a lane without an account, a state that cannot be stored, the
 * tunnel service's own failures); nothing here is a Promise, a Nest provider or a hook. The collaborators are yielded when a
 * method runs.
 */
export class CloudflareTunnelEdge extends Context.Service<
    CloudflareTunnelEdge,
    CloudflareTunnelEdgeShape
>()('fleet/CloudflareTunnelEdge') {
    static readonly live = class CloudflareTunnelEdgeImpl
        implements CloudflareTunnelEdgeShape
    {
        provision(ctx: EdgeContext): ReturnType<CloudflareTunnelEdgeShape['provision']> {
            return Effect.gen(function* () {
                const tunnels = yield* CloudflareTunnelService
                const store = yield* EdgeStateStore
                const accountId = yield* accountOf(ctx.lane)
                const wildcard = `*.${ctx.lane.domain}`
                let current: TunnelState | null = yield* readState(store)

                // Moving to another account: the old tunnel would keep its connectors' token valid and route nothing, so
                // remove it first.
                if (current !== null && current.accountId !== accountId)
                    yield* teardownWith(tunnels, store)
                current = yield* readState(store)

                if (current === null) {
                    yield* Effect.logInfo(
                        `Creating the stack tunnel on Cloudflare account ${accountId}`
                    )
                    // `createTunnel` adopts a tunnel this account already owns under the same name, so a retry after a
                    // partial failure does not create a second one.
                    const created = yield* tunnels.createTunnel(accountId, {
                        name: ctx.resourceName,
                    })
                    current = {
                        accountId,
                        tunnelId: created.tunnel.id,
                        token: created.token,
                        wildcard,
                    }
                }
                yield* store.write(CLOUDFLARE_TUNNEL_EDGE_ID, stateSchema, {
                    ...current,
                    wildcard,
                })
                // ONE wildcard rule. No DNS here: that is the DNS plane's job (`dnsRecords`).
                yield* tunnels.configureIngress(
                    accountId,
                    current.tunnelId,
                    wildcard,
                    ctx.ingressTarget
                )
            })
        }

        teardown(): ReturnType<CloudflareTunnelEdgeShape['teardown']> {
            return Effect.gen(function* () {
                yield* teardownWith(yield* CloudflareTunnelService, yield* EdgeStateStore)
            })
        }

        connector(ctx: EdgeContext): ReturnType<CloudflareTunnelEdgeShape['connector']> {
            return Effect.gen(function* () {
                const settings = yield* CloudflaredSettings
                const current = yield* stateForLane(yield* EdgeStateStore, ctx.lane)
                if (current === null) return null
                return {
                    image: settings.image(),
                    // `TUNNEL_TOKEN` is the variable cloudflared reads for exactly this; a token in argv would be readable
                    // through `docker inspect`.
                    env: [`TUNNEL_TOKEN=${current.token}`],
                    command: ['cloudflared'],
                    args: ['tunnel', '--no-autoupdate', 'run'],
                    replicas: settings.replicas(),
                } satisfies EdgeConnectorSpec
            })
        }

        dnsRecords(ctx: EdgeContext): ReturnType<CloudflareTunnelEdgeShape['dnsRecords']> {
            return Effect.gen(function* () {
                const current = yield* stateForLane(yield* EdgeStateStore, ctx.lane)
                if (current === null) return []
                return [
                    {
                        name: `*.${ctx.lane.domain}`,
                        type: 'CNAME' as const,
                        contents: [`${current.tunnelId}.cfargotunnel.com`],
                        proxied: true,
                        preferredAccountId: current.accountId,
                    },
                ] satisfies EdgeDnsRecord[]
            })
        }

        status(ctx: EdgeContext): ReturnType<CloudflareTunnelEdgeShape['status']> {
            return Effect.gen(function* () {
                const tunnels = yield* CloudflareTunnelService
                const current = yield* stateForLane(yield* EdgeStateStore, ctx.lane)
                if (current === null) {
                    return {
                        provisioned: false,
                        health: 'down',
                        detail: 'The tunnel is not created yet. Save the public lane to create it.',
                        facts: [],
                        resources: [],
                    } satisfies EdgeStatus
                }
                const health = yield* tunnels.getTunnelHealth(
                    current.accountId,
                    current.tunnelId
                )
                const mapped =
                    health.status === 'healthy'
                        ? 'healthy'
                        : health.status === 'degraded'
                          ? 'degraded'
                          : health.status === 'unknown'
                            ? 'unknown'
                            : 'down'
                return {
                    provisioned: true,
                    health: mapped,
                    detail:
                        health.error ??
                        (health.connections === 0
                            ? 'No connector is connected yet — the connector service may still be starting.'
                            : null),
                    facts: [
                        { label: 'Tunnel', value: current.tunnelId },
                        {
                            label: 'Routes',
                            value: `${current.wildcard} → ${ctx.ingressTarget}`,
                        },
                        { label: 'Connections', value: String(health.connections) },
                        { label: 'Cloudflare status', value: health.status },
                    ],
                    resources: [
                        {
                            kind: 'tunnel',
                            id: current.tunnelId,
                            accountId: current.accountId,
                        },
                    ],
                } satisfies EdgeStatus
            })
        }

        stackWildcard(
            accountId: string,
            tunnelId: string
        ): ReturnType<CloudflareTunnelEdgeShape['stackWildcard']> {
            return Effect.gen(function* () {
                const current = yield* readState(yield* EdgeStateStore)
                return current !== null &&
                    current.accountId === accountId &&
                    current.tunnelId === tunnelId
                    ? current.wildcard
                    : null
            })
        }

        forgetDeletedTunnel(
            accountId: string,
            tunnelId: string
        ): ReturnType<CloudflareTunnelEdgeShape['forgetDeletedTunnel']> {
            return Effect.gen(function* () {
                const store = yield* EdgeStateStore
                const current = yield* readState(store)
                const isStackTunnel =
                    current !== null &&
                    current.accountId === accountId &&
                    current.tunnelId === tunnelId
                if (!isStackTunnel) return false
                yield* store.clear(CLOUDFLARE_TUNNEL_EDGE_ID)
                yield* Effect.logInfo(
                    `Forgot stack tunnel ${tunnelId} (deleted from the tunnels page)`
                )
                return true
            })
        }
    }
}

/**
 * The tunnel edge as the shared plugin contract wants it: Effects with an empty requirement channel.
 *
 * The registry and its callers live in `shared` and know nothing of this module's services, so the provider supplies them
 * itself: each operation provides the app's Effect context (`host.context()`) to the service's Effect. It is the provider's
 * own wiring, an Effect all the way through, with no Promise in it.
 */
export function edgeProviderOver(host: EffectHostShape): EdgeProvider {
    const withContext = <A, E, R>(
        effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E> =>
        Effect.promise(() => host.context()).pipe(
            // The context is the app's: it holds every service of every module, so the service's requirements are met.
            Effect.flatMap(
                (context) =>
                    Effect.provideContext(
                        effect,
                        context as Context.Context<R>
                    )
            )
        )
    const use = <A, E, R>(
        run: (edge: CloudflareTunnelEdgeShape) => Effect.Effect<A, E, R>
    ): Effect.Effect<A, E> =>
        withContext(
            Effect.gen(function* () {
                return yield* run(yield* CloudflareTunnelEdge)
            })
        )
    return {
        descriptor: DESCRIPTOR,
        ingress: ingressPlan,
        joinPath: joinPathOf,
        provision: (ctx) => use((edge) => edge.provision(ctx)),
        teardown: () => use((edge) => edge.teardown()),
        connector: (ctx) => use((edge) => edge.connector(ctx)),
        dnsRecords: (ctx) => use((edge) => edge.dnsRecords(ctx)),
        status: (ctx) => use((edge) => edge.status(ctx)),
    }
}
