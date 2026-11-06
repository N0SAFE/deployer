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
import { serviceOver, type Over } from '@deployer/effect-core'
import type { EffectHostShape } from '@deployer/nest-effect'
import type {
    EdgeConnectorSpec,
    EdgeContext,
    EdgeDnsRecord,
    EdgeIngressPlan,
    EdgeProvider,
} from '@deployer/shared/core/modules/edge/edge-provider'
import { EdgeStateStore } from '@deployer/shared/core/modules/edge/edge-state.store'

import { FleetInvalid } from '../../../../core/fleet.errors'
import { CloudflareTunnelService } from '../../dns/cloudflare/services/cloudflare-tunnel.service'

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

/**
 * The stack tunnel, as an Effect service over the tunnel API, the edge state store and the connector settings.
 *
 * Every method is an Effect that fails with its own typed errors (a lane without an account, a state that cannot be stored, the
 * tunnel service's own failures); nothing here is a Promise, a Nest provider or a hook.
 */
const makeCloudflareTunnelEdge = ({
    tunnels,
    store,
    settings,
}: {
    readonly tunnels: Context.Service.Shape<typeof CloudflareTunnelService>
    readonly store: Context.Service.Shape<typeof EdgeStateStore>
    readonly settings: Context.Service.Shape<typeof CloudflaredSettings>
}) => {
    const state = () => store.read(CLOUDFLARE_TUNNEL_EDGE_ID, stateSchema)

    /** The state, but only when it belongs to the account the lane names. */
    const stateFor = (lane: PublicLane) =>
        Effect.gen(function* () {
            const account = yield* accountOf(lane)
            const current = yield* state()
            return current !== null && current.accountId === account
                ? current
                : null
        })

    const teardown = Effect.fn('CloudflareTunnelEdge.teardown')(function* () {
        const current = yield* state()
        if (current === null) return
        // Provider first: forgetting the id first would orphan a tunnel nobody can name.
        yield* tunnels.deleteTunnel(current.accountId, current.tunnelId)
        yield* store.clear(CLOUDFLARE_TUNNEL_EDGE_ID)
        yield* Effect.logInfo(
            `Deleted stack tunnel ${current.tunnelId} (account ${current.accountId})`
        )
    })

    return {
        /** Make the provider side exist and route `*.<domain>` to the ingress target. Idempotent. */
        provision: Effect.fn('CloudflareTunnelEdge.provision')(function* (
            ctx: EdgeContext
        ) {
            const accountId = yield* accountOf(ctx.lane)
            const wildcard = `*.${ctx.lane.domain}`
            let current: TunnelState | null = yield* state()

            // Moving to another account: the old tunnel would keep its connectors' token valid and route nothing, so remove
            // it first.
            if (current !== null && current.accountId !== accountId)
                yield* teardown()
            current = yield* state()

            if (current === null) {
                yield* Effect.logInfo(
                    `Creating the stack tunnel on Cloudflare account ${accountId}`
                )
                // `createTunnel` adopts a tunnel this account already owns under the same name, so a retry after a partial
                // failure does not create a second one.
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
        }),

        /** Remove everything the provider created, and its state. Idempotent. */
        teardown,

        /** The connector the cluster must run, or null when the tunnel is not this lane's. */
        connector: Effect.fn('CloudflareTunnelEdge.connector')(function* (
            ctx: EdgeContext
        ): Effect.fn.Return<EdgeConnectorSpec | null, unknown> {
            const current = yield* stateFor(ctx.lane)
            if (current === null) return null
            return {
                image: settings.image(),
                // `TUNNEL_TOKEN` is the variable cloudflared reads for exactly this; a token in argv would be readable through
                // `docker inspect`.
                env: [`TUNNEL_TOKEN=${current.token}`],
                command: ['cloudflared'],
                args: ['tunnel', '--no-autoupdate', 'run'],
                replicas: settings.replicas(),
            }
        }),

        dnsRecords: Effect.fn('CloudflareTunnelEdge.dnsRecords')(function* (
            ctx: EdgeContext
        ) {
            const current = yield* stateFor(ctx.lane)
            if (current === null) return [] satisfies EdgeDnsRecord[]
            return [
                {
                    name: `*.${ctx.lane.domain}`,
                    type: 'CNAME' as const,
                    contents: [`${current.tunnelId}.cfargotunnel.com`],
                    proxied: true,
                    preferredAccountId: current.accountId,
                },
            ] satisfies EdgeDnsRecord[]
        }),

        status: Effect.fn('CloudflareTunnelEdge.status')(function* (
            ctx: EdgeContext
        ) {
            const current = yield* stateFor(ctx.lane)
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
                    {
                        label: 'Connections',
                        value: String(health.connections),
                    },
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
        }),

        // ─── Called by the Cloudflare tunnels page ─────────────────────────────

        /** The wildcard the stack tunnel routes, when `tunnelId` on `accountId` is it. */
        stackWildcard: Effect.fn('CloudflareTunnelEdge.stackWildcard')(function* (
            accountId: string,
            tunnelId: string
        ) {
            const current = yield* state()
            return current !== null &&
                current.accountId === accountId &&
                current.tunnelId === tunnelId
                ? current.wildcard
                : null
        }),

        /** Forget the stack tunnel after it was deleted from the tunnels page. True when it was the stack's. */
        forgetDeletedTunnel: Effect.fn('CloudflareTunnelEdge.forgetDeletedTunnel')(
            function* (accountId: string, tunnelId: string) {
                const current = yield* state()
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
            }
        ),
    }
}

export type CloudflareTunnelEdgeShape = Over<
    ReturnType<typeof makeCloudflareTunnelEdge>,
    CloudflareTunnelService | EdgeStateStore | CloudflaredSettings
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareTunnelEdge extends Context.Service<
    CloudflareTunnelEdge,
    CloudflareTunnelEdgeShape
>()('fleet/CloudflareTunnelEdge') {
    /** The collaborators are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: CloudflareTunnelEdgeShape = serviceOver(
        Effect.all({
            tunnels: CloudflareTunnelService,
            store: EdgeStateStore,
            settings: CloudflaredSettings,
        }),
        makeCloudflareTunnelEdge
    )
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
