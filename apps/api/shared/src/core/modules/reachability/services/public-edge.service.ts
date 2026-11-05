/**
 * PublicEdgeService — the stack's public edge: the registered provider behind the
 * public lane, seen through one context.
 *
 * Every consumer (the Network pages, the connector supervisor, the DNS plane, the
 * domain gate) asks HERE rather than building an `EdgeContext` itself, so the
 * facts a provider sees — the ingress target, the nodes' public addresses, the
 * resource name — are the same whoever asks.
 *
 * A lane naming a provider this API does not have (a plugin removed, a setting
 * written by a newer version) is reported as a DOWN edge with the reason — never
 * as "no public lane", which would hide that the operator asked for one.
 */

import { Context, Effect } from 'effect'

import type {
    EdgeProviderDescriptor,
    EdgeStatus,
    IngressLanes,
    PublicJoinPath,
} from '@deployer/contracts-entities/entities/ingress/index'

import { LANE_ENTRYPOINTS } from '../../platform-ingress/services/lane-traefik-config'
import { platformTraefikContainerName } from '../../platform-ingress/services/platform-names'
import { EdgeProviderFailure } from '../reachability.errors'

import { toNodeNetworkConfigData } from './node-network-config.mapper'

import type {
    EdgeConnectorSpec,
    EdgeContext,
    EdgeDnsRecord,
    EdgeProvider,
} from '../../edge/edge-provider'
import type { EdgeProviderRegistryShape } from '../../edge/edge-provider.registry'
import type { NodeNetworkConfigRepositoryShape } from '../repositories/node-network-config.repository'

/**
 * Name of the stack's resources on a provider account. Stack-scoped, so a retry
 * adopts the resource it created before instead of creating a second one.
 */
export function stackResourceName(prefix: string | undefined): string {
    const clean = (prefix ?? '').trim()
    return clean === '' ? 'deployer-stack' : `deployer-stack-${clean}`
}

export type PublicEdgeView = {
    provider: EdgeProviderDescriptor | null
    /** The provider id the lane names, even when it is not registered. */
    providerId: string
    status: EdgeStatus
}

export type PublicEdgeServiceShape = {
    /** Traefik's `public` entrypoint on the platform overlay: the one target every edge forwards to. */
    readonly ingressTarget: () => string
    /** The provider and context for the lanes' public lane, or null when there is none / it is not registered. Never fails: unreadable node addresses read as none. */
    readonly resolve: (
        lanes: IngressLanes
    ) => Effect.Effect<{ provider: EdgeProvider; ctx: EdgeContext } | null>
    /** The public edge as the UI shows it, or null when there is no public lane. Never fails: a provider that errors reads as an unknown edge. */
    readonly view: (lanes: IngressLanes) => Effect.Effect<PublicEdgeView | null>
    /** How a stranger joins through the public lane, or null when there is none. */
    readonly joinPath: (
        lanes: IngressLanes
    ) => Effect.Effect<PublicJoinPath | null, EdgeProviderFailure>
    /** Records the public lane needs. Empty when there is no public lane. */
    readonly dnsRecords: (
        lanes: IngressLanes
    ) => Effect.Effect<EdgeDnsRecord[], EdgeProviderFailure>
    /** The process the cluster must run for the edge, labelled with its provider. */
    readonly connector: (
        lanes: IngressLanes
    ) => Effect.Effect<
        { providerId: string; spec: EdgeConnectorSpec } | null,
        EdgeProviderFailure
    >
}

type Ports = {
    readonly registry: EdgeProviderRegistryShape
    readonly nodeConfigs: NodeNetworkConfigRepositoryShape
    /** The `DEPLOYER_PREFIX` environment value. */
    readonly prefix: string | undefined
}

export function makePublicEdgeService({
    registry,
    nodeConfigs,
    prefix,
}: Ports): PublicEdgeServiceShape {
    const ingressTarget = (): string =>
        `http://${platformTraefikContainerName(prefix)}:${String(LANE_ENTRYPOINTS.public.port)}`

    const resolve: PublicEdgeServiceShape['resolve'] = (lanes) =>
        Effect.gen(function* () {
            if (lanes.public === null) return null
            const provider = registry.find(lanes.public.provider)
            if (provider === null) return null
            const rows = yield* nodeConfigs
                .list()
                .pipe(
                    Effect.catch((error) =>
                        Effect.logWarning(
                            `Node addresses unavailable: ${error.message}`
                        ).pipe(
                            Effect.as(
                                [] as Effect.Success<
                                    ReturnType<typeof nodeConfigs.list>
                                >
                            )
                        )
                    )
                )
            return {
                provider,
                ctx: {
                    lane: lanes.public,
                    ingressTarget: ingressTarget(),
                    nodes: rows.map((row) =>
                        toNodeNetworkConfigData(row.nodeId, row)
                    ),
                    resourceName: stackResourceName(prefix),
                },
            }
        })

    /** The provider's own status: a provider that fails reads as an unknown edge, not as an error page. */
    const statusOf = ({
        provider,
        ctx,
    }: {
        provider: EdgeProvider
        ctx: EdgeContext
    }): Effect.Effect<EdgeStatus> =>
        Effect.tryPromise({
            try: () => provider.status(ctx),
            catch: (cause) => cause,
        }).pipe(
            Effect.catch((cause) =>
                Effect.succeed({
                    provisioned: false,
                    health: 'unknown',
                    detail: `${provider.descriptor.label} status unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
                    facts: [],
                    resources: [],
                } satisfies EdgeStatus)
            )
        )

    /** One provider call: any failure is an `EdgeProviderFailure` for `operation`. */
    const providerCall = <A>(
        provider: EdgeProvider,
        operation: string,
        run: () => Promise<A>
    ) =>
        Effect.tryPromise({
            try: run,
            catch: (cause) =>
                new EdgeProviderFailure({
                    providerId: provider.descriptor.id,
                    operation,
                    cause,
                }),
        })

    return {
        ingressTarget,
        resolve,

        view: (lanes) =>
            Effect.gen(function* () {
                if (lanes.public === null) return null
                const resolved = yield* resolve(lanes)
                if (resolved === null) {
                    return {
                        provider: null,
                        providerId: lanes.public.provider,
                        status: {
                            provisioned: false,
                            health: 'down',
                            detail: `The public lane uses '${lanes.public.provider}', which is not available on this API. Pick another edge provider.`,
                            facts: [],
                            resources: [],
                        },
                    } satisfies PublicEdgeView
                }
                return {
                    provider: resolved.provider.descriptor,
                    providerId: resolved.provider.descriptor.id,
                    status: yield* statusOf(resolved),
                } satisfies PublicEdgeView
            }),

        joinPath: (lanes) =>
            Effect.gen(function* () {
                const resolved = yield* resolve(lanes)
                if (resolved === null) return null
                const status = yield* statusOf(resolved)
                return yield* Effect.try({
                    try: () => resolved.provider.joinPath(resolved.ctx, status),
                    catch: (cause) =>
                        new EdgeProviderFailure({
                            providerId: resolved.provider.descriptor.id,
                            operation: 'join path',
                            cause,
                        }),
                })
            }),

        dnsRecords: (lanes) =>
            Effect.gen(function* () {
                const resolved = yield* resolve(lanes)
                return resolved === null
                    ? []
                    : yield* providerCall(
                          resolved.provider,
                          'DNS records',
                          () => resolved.provider.dnsRecords(resolved.ctx)
                      )
            }),

        connector: (lanes) =>
            Effect.gen(function* () {
                const resolved = yield* resolve(lanes)
                if (resolved === null) return null
                const spec = yield* providerCall(
                    resolved.provider,
                    'connector',
                    () => resolved.provider.connector(resolved.ctx)
                )
                return spec === null
                    ? null
                    : { providerId: resolved.provider.descriptor.id, spec }
            }),
    }
}

export class PublicEdgeService extends Context.Service<
    PublicEdgeService,
    PublicEdgeServiceShape
>()('shared/PublicEdgeService') {}
