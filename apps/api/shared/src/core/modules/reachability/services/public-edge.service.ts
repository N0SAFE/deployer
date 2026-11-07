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

import {
    type EdgeConnectorSpec,
    type EdgeContext,
    type EdgeDnsRecord,
    type EdgeProvider,
} from '../../edge/edge-provider'
import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import { LANE_ENTRYPOINTS } from '../../platform-ingress/services/lane-traefik-config'
import { platformTraefikContainerName } from '../../platform-ingress/services/platform-names'
import { EdgeProviderFailure } from '../reachability.errors'
import {
    NodeNetworkConfigRepository,
    type NodeNetworkConfigRow,
} from '../repositories/node-network-config.repository'

import { toNodeNetworkConfigData } from './node-network-config.mapper'

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

/** The collaborators one public-edge call yields: the registry and the nodes' addresses. */
export type PublicEdgeServiceShape = {
    /** Traefik's `public` entrypoint on the platform overlay: the one target every edge forwards to. */
    readonly ingressTarget: () => string
    /** The provider and context for the lanes' public lane, or null when there is none / it is not registered. Never fails: unreadable node addresses read as none. */
    readonly resolve: (lanes: IngressLanes) => Effect.Effect<
        { provider: EdgeProvider; ctx: EdgeContext } | null,
        never,
        EdgeProviderRegistry | NodeNetworkConfigRepository
    >
    /** The public edge as the UI shows it, or null when there is no public lane. Never fails: a provider that errors reads as an unknown edge. */
    readonly view: (lanes: IngressLanes) => Effect.Effect<
        PublicEdgeView | null,
        never,
        EdgeProviderRegistry | NodeNetworkConfigRepository
    >
    /** How a stranger joins through the public lane, or null when there is none. */
    readonly joinPath: (lanes: IngressLanes) => Effect.Effect<
        PublicJoinPath | null,
        EdgeProviderFailure,
        EdgeProviderRegistry | NodeNetworkConfigRepository
    >
    /** Records the public lane needs. Empty when there is no public lane. */
    readonly dnsRecords: (lanes: IngressLanes) => Effect.Effect<
        EdgeDnsRecord[],
        EdgeProviderFailure,
        EdgeProviderRegistry | NodeNetworkConfigRepository
    >
    /** The process the cluster must run for the edge, labelled with its provider. */
    readonly connector: (lanes: IngressLanes) => Effect.Effect<
        { providerId: string; spec: EdgeConnectorSpec } | null,
        EdgeProviderFailure,
        EdgeProviderRegistry | NodeNetworkConfigRepository
    >
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The registry and the nodes' addresses are yielded per call. `prefix` is a plain value the module hands over (it is
 * what names the stack's provider resources), so it is a constructor argument rather than a service.
 */
export class PublicEdgeService extends Context.Service<
    PublicEdgeService,
    PublicEdgeServiceShape
>()('shared/PublicEdgeService') {
    static readonly live = class PublicEdgeServiceImpl
        implements PublicEdgeServiceShape
    {
        constructor(private readonly prefix: string | undefined) {}

        ingressTarget(): string {
            return `http://${platformTraefikContainerName(this.prefix)}:${String(LANE_ENTRYPOINTS.public.port)}`
        }

        resolve(
            lanes: IngressLanes
        ): ReturnType<PublicEdgeServiceShape['resolve']> {
            return Effect.gen({ self: this }, function* () {
                if (lanes.public === null) return null
                const registry = yield* EdgeProviderRegistry
                const provider = registry.find(lanes.public.provider)
                if (provider === null) return null
                const nodeConfigs = yield* NodeNetworkConfigRepository
                const rows = yield* nodeConfigs.list().pipe(
                    Effect.catch((error) =>
                        Effect.logWarning(
                            `Node addresses unavailable: ${error.message}`
                        ).pipe(Effect.as([] as NodeNetworkConfigRow[]))
                    )
                )
                return {
                    provider,
                    ctx: {
                        lane: lanes.public,
                        ingressTarget: this.ingressTarget(),
                        nodes: rows.map((row) =>
                            toNodeNetworkConfigData(row.nodeId, row)
                        ),
                        resourceName: stackResourceName(this.prefix),
                    },
                }
            })
        }

        /** The provider's own status: a provider that fails reads as an unknown edge, not as an error page. */
        private statusOf({
            provider,
            ctx,
        }: {
            provider: EdgeProvider
            ctx: EdgeContext
        }): Effect.Effect<EdgeStatus> {
            return provider.status(ctx).pipe(
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
        }

        /** One provider call: any failure is an `EdgeProviderFailure` for `operation`. */
        private providerCall<A>(
            provider: EdgeProvider,
            operation: string,
            run: () => Effect.Effect<A, unknown>
        ): Effect.Effect<A, EdgeProviderFailure> {
            return run().pipe(
                Effect.mapError(
                    (cause) =>
                        new EdgeProviderFailure({
                            providerId: provider.descriptor.id,
                            operation,
                            cause,
                        })
                )
            )
        }

        view(
            lanes: IngressLanes
        ): ReturnType<PublicEdgeServiceShape['view']> {
            return Effect.gen({ self: this }, function* () {
                if (lanes.public === null) return null
                const resolved = yield* this.resolve(lanes)
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
                    status: yield* this.statusOf(resolved),
                } satisfies PublicEdgeView
            })
        }

        joinPath(
            lanes: IngressLanes
        ): ReturnType<PublicEdgeServiceShape['joinPath']> {
            return Effect.gen({ self: this }, function* () {
                const resolved = yield* this.resolve(lanes)
                if (resolved === null) return null
                const status = yield* this.statusOf(resolved)
                return yield* Effect.try({
                    try: () => resolved.provider.joinPath(resolved.ctx, status),
                    catch: (cause) =>
                        new EdgeProviderFailure({
                            providerId: resolved.provider.descriptor.id,
                            operation: 'join path',
                            cause,
                        }),
                })
            })
        }

        dnsRecords(
            lanes: IngressLanes
        ): ReturnType<PublicEdgeServiceShape['dnsRecords']> {
            return Effect.gen({ self: this }, function* () {
                const resolved = yield* this.resolve(lanes)
                return resolved === null
                    ? []
                    : yield* this.providerCall(
                          resolved.provider,
                          'DNS records',
                          () => resolved.provider.dnsRecords(resolved.ctx)
                      )
            })
        }

        connector(
            lanes: IngressLanes
        ): ReturnType<PublicEdgeServiceShape['connector']> {
            return Effect.gen({ self: this }, function* () {
                const resolved = yield* this.resolve(lanes)
                if (resolved === null) return null
                const spec = yield* this.providerCall(
                    resolved.provider,
                    'connector',
                    () => resolved.provider.connector(resolved.ctx)
                )
                return spec === null
                    ? null
                    : { providerId: resolved.provider.descriptor.id, spec }
            })
        }
    }
}
