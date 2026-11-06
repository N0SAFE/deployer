import { Context, Effect } from 'effect'
import { Observable } from 'rxjs'

import type { NodeNetworkConfigData } from '@deployer/shared/core/modules/reachability/services/node-network-config.mapper'
import type { PublicAccessPointServiceShape } from '@deployer/shared/core/modules/reachability/services/public-access-point.service'
import type { ReachabilityServiceShape } from '@deployer/shared/core/modules/reachability/services/reachability.service'

import { attemptSync } from '../../../core/effects'
import {
    EgressPort,
    PublicAccessPointPort,
    ReachabilityCorePort,
    TraefikRefresherPort,
} from '../reachability.ports'

/** A node's own network config as the contract sees it (the public edge belongs to the stack). */
type NodeNetworkView = NodeNetworkConfigData

/** What the shared services answer, so this layer's types follow them rather than restate them. */
type DomainCheck = Effect.Success<
    ReturnType<ReachabilityServiceShape['checkDomainReachability']>
>
type DomainGate = Effect.Success<
    ReturnType<ReachabilityServiceShape['checkDomainGate']>
>
type AccessPointState = Effect.Success<
    ReturnType<PublicAccessPointServiceShape['getAccessPoint']>
>
type NodeConfigUpdate = Parameters<
    ReachabilityServiceShape['updateNodeNetworkConfig']
>[0]

/** Live availability of the stack's public URL. */
type PublicUrlProbe = {
    publicUrl: string | null
    lastCheckedAt: string | null
    lastStatus: string | null
    reachable: boolean | null
}

const describe = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback

/**
 * What the reachability service reads from the Effect context while it runs.
 */
export type NodeReachabilityPorts =
    | ReachabilityCorePort
    | PublicAccessPointPort
    | EgressPort
    | TraefikRefresherPort

export type NodeReachabilityServiceShape = {
    /** Probe a URL through the operator egress policy; failures are reported as a category. */
    readonly check: (url: string) => Effect.Effect<
        {
            url: string
            reachable: boolean
            latencyMs: number
            statusCode?: number
            error?: string
        },
        never,
        NodeReachabilityPorts
    >
    /**
     * The stack's public URL, live. The URL is derived and never stored, so `getConfig` and
     * `updateConfig` are the same question and must not drift apart.
     */
    readonly probePublicUrl: () => Effect.Effect<
        PublicUrlProbe,
        unknown,
        NodeReachabilityPorts
    >
    readonly checkDomain: (
        domain: string,
        expectedIp?: string
    ) => Effect.Effect<DomainCheck, unknown, NodeReachabilityPorts>
    readonly getPublicIp: () => Effect.Effect<
        { ip: string | null },
        unknown,
        NodeReachabilityPorts
    >
    readonly getNodeNetworkConfig: (
        nodeId: Parameters<ReachabilityServiceShape['getNodeNetworkConfig']>[0]
    ) => Effect.Effect<NodeNetworkView, unknown, NodeReachabilityPorts>
    readonly listNodeNetworkConfigs: () => Effect.Effect<
        { configs: NodeNetworkView[] },
        unknown,
        NodeReachabilityPorts
    >
    /** Changing a node's address makes Traefik publish the new Host rule: re-converge now. */
    readonly updateNodeNetworkConfig: (
        input: NodeConfigUpdate
    ) => Effect.Effect<NodeNetworkView, unknown, NodeReachabilityPorts>
    readonly checkDomainGate: () => Effect.Effect<
        Pick<
            DomainGate,
            'allowed' | 'reason' | 'publicAddress' | 'addressKind'
        >,
        unknown,
        NodeReachabilityPorts
    >
    /** Request, live re-check, push onto the global relay, return the fresh state. */
    readonly getPublicAccessPoint: () => Effect.Effect<
        AccessPointState,
        unknown,
        NodeReachabilityPorts
    >
    /** Emits the current state and every subsequent push. */
    readonly watchPublicAccessPoint: () => Effect.Effect<
        Observable<AccessPointState>,
        unknown,
        NodeReachabilityPorts
    >
}

const toNodeNetworkView = (config: NodeNetworkConfigData): NodeNetworkView => ({
    nodeId: config.nodeId,
    publicAddress: config.publicAddress,
    addressKind: config.addressKind,
    updatedAt: config.updatedAt,
})

/** 2xx, the one definition of "the probe answered". */
const isOk = (status: number) => status >= 200 && status < 300

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class NodeReachabilityService extends Context.Service<
    NodeReachabilityService,
    NodeReachabilityServiceShape
>()('fleet/NodeReachabilityService') {
    /** The ports are yielded when a method runs, so this is a class the module provides with `useClass`. */
    static readonly live = class NodeReachabilityServiceImpl implements NodeReachabilityServiceShape {
        check(url: string): ReturnType<NodeReachabilityServiceShape['check']> {
            return Effect.gen(function* () {
                const egress = yield* EgressPort
                const probeUrl = `${url.replace(/\/$/, '')}/mesh/ping`
                const start = Date.now()
                // Any authenticated user can name this URL: it goes through the operator egress policy
                // (no loopback / link-local / metadata, no redirects) and failures are reported as a
                // category, never as a resolved address or a transport error.
                return yield* egress.operator({ url: probeUrl }).pipe(
                    Effect.map((resp) => ({
                        url,
                        reachable: isOk(resp.status),
                        latencyMs: Date.now() - start,
                        statusCode: resp.status,
                        error: isOk(resp.status)
                            ? undefined
                            : `HTTP ${String(resp.status)}`,
                    })),
                    Effect.catch((err) =>
                        Effect.succeed({
                            url,
                            reachable: false,
                            latencyMs: Date.now() - start,
                            error: describe(err, 'Connection failed'),
                        })
                    )
                )
            })
        }

        probePublicUrl(): ReturnType<
            NodeReachabilityServiceShape['probePublicUrl']
        > {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                const egress = yield* EgressPort
                const publicUrl = yield* reachability.getNodePublicUrl()
                if (!publicUrl)
                    return {
                        publicUrl: null,
                        lastCheckedAt: null,
                        lastStatus: null,
                        reachable: null,
                    }
                return yield* egress
                    .operator({ url: `${publicUrl}/health` })
                    .pipe(
                        Effect.map((resp): PublicUrlProbe => ({
                            publicUrl,
                            lastCheckedAt: new Date().toISOString(),
                            lastStatus: isOk(resp.status)
                                ? 'reachable'
                                : `http_${String(resp.status)}`,
                            reachable: isOk(resp.status),
                        })),
                        Effect.catch((err) =>
                            Effect.succeed<PublicUrlProbe>({
                                publicUrl,
                                lastCheckedAt: new Date().toISOString(),
                                lastStatus: describe(err, 'unreachable'),
                                reachable: false,
                            })
                        )
                    )
            })
        }

        checkDomain(
            domain: string,
            expectedIp?: string
        ): ReturnType<NodeReachabilityServiceShape['checkDomain']> {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                return yield* reachability.checkDomainReachability(
                    domain,
                    expectedIp
                )
            })
        }

        getPublicIp(): ReturnType<NodeReachabilityServiceShape['getPublicIp']> {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                return { ip: yield* reachability.getPublicIp() }
            })
        }

        getNodeNetworkConfig(
            nodeId: Parameters<
                ReachabilityServiceShape['getNodeNetworkConfig']
            >[0]
        ): ReturnType<NodeReachabilityServiceShape['getNodeNetworkConfig']> {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                return toNodeNetworkView(
                    yield* reachability.getNodeNetworkConfig(nodeId)
                )
            })
        }

        listNodeNetworkConfigs(): ReturnType<
            NodeReachabilityServiceShape['listNodeNetworkConfigs']
        > {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                const configs = yield* reachability.listNodeNetworkConfigs()
                return { configs: configs.map(toNodeNetworkView) }
            })
        }

        updateNodeNetworkConfig(
            input: NodeConfigUpdate
        ): ReturnType<NodeReachabilityServiceShape['updateNodeNetworkConfig']> {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                const refresher = yield* TraefikRefresherPort
                const updated =
                    yield* reachability.updateNodeNetworkConfig(input)
                refresher.refresh()
                return toNodeNetworkView(updated)
            })
        }

        checkDomainGate(): ReturnType<
            NodeReachabilityServiceShape['checkDomainGate']
        > {
            return Effect.gen(function* () {
                const reachability = yield* ReachabilityCorePort
                const gate = yield* reachability.checkDomainGate()
                return {
                    allowed: gate.allowed,
                    reason: gate.reason,
                    publicAddress: gate.publicAddress,
                    addressKind: gate.addressKind,
                }
            })
        }

        getPublicAccessPoint(): ReturnType<
            NodeReachabilityServiceShape['getPublicAccessPoint']
        > {
            return Effect.gen(function* () {
                const accessPoint = yield* PublicAccessPointPort
                const state = yield* accessPoint.getAccessPoint()
                yield* Effect.logInfo(
                    `Public access point requested: kind=${String(state.kind)} url=${state.publicUrl ?? 'none'} reachable=${String(state.reachable)}`
                )
                return state
            })
        }

        watchPublicAccessPoint(): ReturnType<
            NodeReachabilityServiceShape['watchPublicAccessPoint']
        > {
            return Effect.gen(function* () {
                const accessPoint = yield* PublicAccessPointPort
                return yield* attemptSync(
                    () =>
                        new Observable<AccessPointState>((subscriber) => {
                            const sub = accessPoint
                                .watchAccessPoint()
                                .subscribe({
                                    next: (state) => {
                                        subscriber.next(state)
                                    },
                                    error: (err) => {
                                        subscriber.error(err)
                                    },
                                })
                            return () => {
                                sub.unsubscribe()
                            }
                        })
                )
            })
        }
    }
}
