import dns from 'node:dns/promises'
import { isIP } from 'node:net'

import { Context, Effect } from 'effect'

import type { HttpRes } from '@deployer/effect-infra'
import { NodeConfigRepository } from '@deployer/node-state'

import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import { EgressService } from '../../egress/egress.service'
import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service'
import {
    NodeNotConfigured,
    PublicAddressUnreachable,
    PublicUrlRequired,
    ReachabilityDependencyFailure,
} from '../reachability.errors'
import { NodeNetworkConfigRepository } from '../repositories/node-network-config.repository'

import {
    deriveAddressKind,
    toNodeNetworkConfigData,
    type NodeNetworkConfigData,
} from './node-network-config.mapper'
import { PublicEdgeService } from './public-edge.service'

import type { PublicAccessPointState } from './public-access-point.state'

/**
 * The node's reachable address, as the domain gate sees it.
 *
 * The public edge is not part of this row: it belongs to the stack, so the gate asks the edge provider rather than a
 * per-node row.
 */
export type NodeAddressGate = {
    allowed: boolean
    reason: string | null
    publicAddress: string | null
    addressKind: 'ip' | 'hostname' | null
}

export type AddressVerification = {
    valid: boolean
    reason?: string
    latencyMs?: number
    statusCode?: number
}

export type DomainReachability = {
    domain: string
    expectedIp: string | undefined
    resolvedIps: string[]
    httpReachable: boolean
    httpStatusCode?: number
    dnsMatch: boolean | null
    error?: string
}

export type MeshUrlReachability = {
    url: string
    reachable: boolean
    probeUrl: string
    latencyMs: number
    advertisedHost?: string
    version?: string
    /** Why it is unreachable (network error, non-2xx answer, refused connection); absent when reachable. */
    error?: string
}

type Failure = ReachabilityDependencyFailure

/** The node's own record, then its network row: what resolving "this node" reads. */
type NodeLookupPorts = NodeConfigRepository | NodeNetworkConfigRepository

/** The lanes (and the cluster store they live in) plus the edge registry: what deriving the public URL reads. */
type PublicUrlPorts =
    | IngressLanesService
    | EdgeProviderRegistry
    | ClusterSettings

export type ReachabilityServiceShape = {
    /** The current node's id (from its agent's record, or the local SQLite file); the network config is keyed by it. */
    readonly getCurrentNodeId: () => Effect.Effect<
        string,
        NodeNotConfigured | Failure,
        NodeConfigRepository
    >
    /** A node's network config (default: this node); a never-configured node reads as an empty default. */
    readonly getNodeNetworkConfig: (
        nodeId?: string
    ) => Effect.Effect<
        NodeNetworkConfigData,
        NodeNotConfigured | Failure,
        NodeLookupPorts
    >
    readonly listNodeNetworkConfigs: () => Effect.Effect<
        NodeNetworkConfigData[],
        Failure,
        NodeNetworkConfigRepository
    >
    /** The node's manual public address, or null (also when it cannot be read). */
    readonly getConfiguredPublicIp: (
        nodeId?: string
    ) => Effect.Effect<string | null, never, NodeLookupPorts>
    /**
     * The platform's PUBLIC URL (where OAuth redirects and webhook callbacks reach the API), derived from the lanes, never
     * from env: only with a public lane on AND the console public on it, `https://api.<public domain>` when the edge serves
     * HTTPS. The apex is NOT used: the edge and its DNS record only cover `*.<domain>`.
     */
    readonly getNodePublicUrl: (
        nodeId?: string
    ) => Effect.Effect<string | null, Failure, PublicUrlPorts>
    /** Like `getNodePublicUrl`, but fails with `PublicUrlRequired`: it BLOCKS what needs the node to be publicly reachable. */
    readonly requireNodePublicUrl: (
        what: string
    ) => Effect.Effect<string, PublicUrlRequired | Failure, PublicUrlPorts>
    /** The FULL public access point state: config (IP / hostname / tunnel + provider) AND a live availability probe. */
    readonly resolveAccessPointState: () => Effect.Effect<
        PublicAccessPointState,
        Failure,
        PublicUrlPorts | EgressService
    >
    /**
     * Persist a node's network config. A non-empty public address MUST verify as pointing at this node (`PublicAddressUnreachable`
     * otherwise); clearing it is always allowed. Edge provisioning is not here: the public edge belongs to the STACK.
     */
    readonly updateNodeNetworkConfig: (input: {
        nodeId?: string
        publicAddress?: string | null
    }) => Effect.Effect<
        NodeNetworkConfigData,
        PublicAddressUnreachable | NodeNotConfigured | Failure,
        NodeLookupPorts | EgressService
    >
    /** Probe an address (`/mesh/ping`, `/health` over https then http). Never fails: the answer says whether it is valid. */
    readonly verifyPublicAddress: (
        address: string
    ) => Effect.Effect<AddressVerification, never, EgressService>
    /**
     * Domain creation gate: a custom domain is served on the public lane. With no public lane a domain can still be registered
     * (it goes live when one is turned on); with one, its provider must report itself provisioned, else its own reason is returned.
     */
    readonly checkDomainGate: () => Effect.Effect<
        NodeAddressGate,
        NodeNotConfigured | Failure,
        NodeLookupPorts | PublicUrlPorts | PublicEdgeService
    >
    /** The public IP of this API server: the configured one, else an external lookup. */
    readonly getPublicIp: () => Effect.Effect<
        string | null,
        never,
        NodeLookupPorts | EgressService
    >
    /** Whether a domain resolves (system DNS, then Google DoH) and answers over HTTP(S). Never fails. */
    readonly checkDomainReachability: (
        domain: string,
        expectedIp?: string
    ) => Effect.Effect<DomainReachability, never, EgressService>
    /** Whether a mesh URL answers `/mesh/ping` (the probe of the remote setup wizard step). */
    readonly checkMeshUrlReachability: (
        url: string
    ) => Effect.Effect<MeshUrlReachability, Failure, EgressService>
}

const IP_LOOKUP_SERVICES = [
    'https://checkip.amazonaws.com',
    'https://api.ipify.org',
    'https://icanhazip.com',
]

/** A storage or lanes failure, named by the operation that raised it. */
const lifted = <A, E extends { readonly message: string }, R>(
    operation: string,
    effect: Effect.Effect<A, E, R>
): Effect.Effect<A, Failure, R> =>
    Effect.mapError(
        effect,
        (cause) => new ReachabilityDependencyFailure({ operation, cause })
    )

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every operation yields the collaborator it needs at the moment it needs it, and its return type names that
 * requirement. There is no ports record and nothing forwards: the logic of each use case is its body.
 */
export class ReachabilityService extends Context.Service<
    ReachabilityService,
    ReachabilityServiceShape
>()('shared/ReachabilityService') {
    static readonly live = class ReachabilityServiceImpl
        implements ReachabilityServiceShape
    {
        getCurrentNodeId(): ReturnType<
            ReachabilityServiceShape['getCurrentNodeId']
        > {
            return Effect.gen(function* () {
                const nodeConfig = yield* NodeConfigRepository
                const row = yield* lifted(
                    'read the node config',
                    nodeConfig.find()
                )
                if (!row?.nodeId) return yield* new NodeNotConfigured({})
                return row.nodeId
            })
        }

        getNodeNetworkConfig(
            nodeId?: string
        ): ReturnType<ReachabilityServiceShape['getNodeNetworkConfig']> {
            return Effect.gen({ self: this }, function* () {
                const target = nodeId?.trim()
                    ? nodeId
                    : yield* this.getCurrentNodeId()
                const nodeNetworkConfigs = yield* NodeNetworkConfigRepository
                const row = yield* lifted(
                    'read the node network config',
                    nodeNetworkConfigs.findByNodeId(target)
                )
                return toNodeNetworkConfigData(target, row)
            })
        }

        listNodeNetworkConfigs(): ReturnType<
            ReachabilityServiceShape['listNodeNetworkConfigs']
        > {
            return Effect.gen(function* () {
                const nodeNetworkConfigs = yield* NodeNetworkConfigRepository
                const rows = yield* lifted(
                    'list the node network configs',
                    nodeNetworkConfigs.list()
                )
                return rows.map((row) =>
                    toNodeNetworkConfigData(row.nodeId, row)
                )
            })
        }

        getConfiguredPublicIp(): ReturnType<
            ReachabilityServiceShape['getConfiguredPublicIp']
        > {
            return Effect.gen({ self: this }, function* () {
                const config = yield* this.getNodeNetworkConfig().pipe(
                    Effect.catch(() => Effect.succeed(null))
                )
                return config?.publicAddress ?? null
            })
        }

        getNodePublicUrl(): ReturnType<
            ReachabilityServiceShape['getNodePublicUrl']
        > {
            return Effect.gen(function* () {
                const lanes = yield* IngressLanesService
                const edges = yield* EdgeProviderRegistry
                const current = yield* lifted(
                    'read the ingress lanes',
                    lanes.getLanes()
                )
                const lane = current.public
                if (lane === null || current.consoleVisibility !== 'public')
                    return null
                const scheme =
                    edges.ingressPlan(current).tls === 'none' ? 'http' : 'https'
                return `${scheme}://api.${lane.domain}`
            })
        }

        requireNodePublicUrl(
            what: string
        ): ReturnType<ReachabilityServiceShape['requireNodePublicUrl']> {
            return Effect.gen({ self: this }, function* () {
                const url = yield* this.getNodePublicUrl()
                if (!url) return yield* new PublicUrlRequired({ what })
                return url
            })
        }

        resolveAccessPointState(): ReturnType<
            ReachabilityServiceShape['resolveAccessPointState']
        > {
            return Effect.gen({ self: this }, function* () {
                const lanes = yield* IngressLanesService
                const edges = yield* EdgeProviderRegistry
                const current = yield* lifted(
                    'read the ingress lanes',
                    lanes.getLanes()
                )
                const edge = edges.active(current)?.descriptor ?? null
                const tunnelEnabled = edge?.kind === 'tunnel'
                const [account = null] = edges.accountsInUse(current)
                const publicUrl = yield* this.getNodePublicUrl()

                if (current.public === null || publicUrl === null) {
                    return {
                        configured: false,
                        kind: null,
                        address: null,
                        publicUrl: null,
                        providerId: null,
                        tunnelEnabled,
                        reachable: false,
                        lastCheckedAt: new Date().toISOString(),
                        latencyMs: null,
                        statusCode: null,
                        error: 'No public lane with a public console is enabled. Turn one on on the Network → Ingress page.',
                    } satisfies PublicAccessPointState
                }

                const verification = yield* this.verifyPublicAddress(publicUrl)
                return {
                    configured: true,
                    kind: tunnelEnabled ? 'tunnel' : 'hostname',
                    address: new URL(publicUrl).hostname,
                    publicUrl,
                    providerId: account,
                    tunnelEnabled,
                    reachable: verification.valid,
                    lastCheckedAt: new Date().toISOString(),
                    latencyMs: verification.latencyMs ?? null,
                    statusCode: verification.statusCode ?? null,
                    error: verification.valid
                        ? null
                        : (verification.reason ??
                          'Public access point is not reachable'),
                } satisfies PublicAccessPointState
            })
        }

        updateNodeNetworkConfig(
            input: Parameters<
                ReachabilityServiceShape['updateNodeNetworkConfig']
            >[0]
        ): ReturnType<ReachabilityServiceShape['updateNodeNetworkConfig']> {
            return Effect.gen({ self: this }, function* () {
                const target = input.nodeId?.trim()
                    ? input.nodeId
                    : yield* this.getCurrentNodeId()
                const current = yield* this.getNodeNetworkConfig(target)

                let publicAddress = current.publicAddress
                if (input.publicAddress !== undefined) {
                    const value = input.publicAddress?.trim() ?? ''
                    if (value) {
                        const verification =
                            yield* this.verifyPublicAddress(value)
                        if (!verification.valid) {
                            return yield* new PublicAddressUnreachable({
                                reason:
                                    verification.reason ??
                                    `Address "${value}" is not reachable from this node`,
                            })
                        }
                        yield* Effect.logInfo(
                            `Public address verified: ${value} (${String(verification.statusCode ?? '')} in ${String(verification.latencyMs ?? '?')}ms)`
                        )
                    }
                    publicAddress = value ? value : null
                }

                const nodeNetworkConfigs = yield* NodeNetworkConfigRepository
                yield* lifted(
                    'save the node network config',
                    nodeNetworkConfigs.upsert({
                        nodeId: target,
                        publicAddress,
                        addressKind: deriveAddressKind(publicAddress),
                    })
                )
                return yield* this.getNodeNetworkConfig(target)
            })
        }

        verifyPublicAddress(
            address: string
        ): ReturnType<ReachabilityServiceShape['verifyPublicAddress']> {
            return Effect.gen(function* () {
                const clean = address.trim().replace(/\/+$/, '')
                if (!clean) return { valid: false, reason: 'Address is empty' }
                const egress = yield* EgressService
                // The probe reports an unreachable address in its result: it never fails.
                const result = yield* egress.probeUserAddress(
                    clean,
                    ['/mesh/ping', '/health'],
                    (value) =>
                        `Address "${value}" did not respond on this node's /mesh/ping or /health endpoints. DNS may still be propagating, or a firewall/NAT prevents this node from reaching its own public address.`
                )
                return {
                    valid: result.valid,
                    reason: result.reason,
                    latencyMs: result.latencyMs,
                    statusCode: result.statusCode,
                }
            })
        }

        checkDomainGate(): ReturnType<
            ReachabilityServiceShape['checkDomainGate']
        > {
            return Effect.gen({ self: this }, function* () {
                const config = yield* this.getNodeNetworkConfig()
                const lanes = yield* IngressLanesService
                const publicEdge = yield* PublicEdgeService
                const current = yield* lifted(
                    'read the ingress lanes',
                    lanes.getLanes()
                )
                const base = {
                    publicAddress: config.publicAddress,
                    addressKind: config.addressKind,
                }
                const edge = yield* publicEdge.view(current)
                if (edge === null || edge.status.provisioned)
                    return { allowed: true, reason: null, ...base }
                return {
                    allowed: false,
                    reason:
                        edge.status.detail ??
                        `The public edge (${edge.provider?.label ?? edge.providerId}) is not ready yet.`,
                    ...base,
                }
            })
        }

        /** A GET through the egress's fixed-host policy; `null` when it fails or answers outside 2xx. */
        private fixedGet(
            url: string,
            hosts: readonly string[]
        ): Effect.Effect<HttpRes | null, never, EgressService> {
            return Effect.gen(function* () {
                const egress = yield* EgressService
                return yield* egress.fixedExternal({ url }, hosts).pipe(
                    Effect.map((resp) =>
                        resp.status >= 200 && resp.status < 300 ? resp : null
                    ),
                    Effect.catch(() => Effect.succeed(null))
                )
            })
        }

        getPublicIp(): ReturnType<ReachabilityServiceShape['getPublicIp']> {
            return Effect.gen({ self: this }, function* () {
                const configured = yield* this.getConfiguredPublicIp()
                if (configured) return configured
                for (const service of IP_LOOKUP_SERVICES) {
                    const resp = yield* this.fixedGet(service, [
                        new URL(service).hostname,
                    ])
                    if (resp === null) continue
                    // The answer is untrusted input that ends up in DNS guidance: only an IP is accepted.
                    const ip = new TextDecoder().decode(resp.body).trim()
                    if (isIP(ip) !== 0) return ip
                }
                return null
            })
        }

        checkDomainReachability(
            domain: string,
            expectedIp?: string
        ): ReturnType<ReachabilityServiceShape['checkDomainReachability']> {
            return Effect.gen({ self: this }, function* () {
                const cleanDomain =
                    (
                        domain.replace(/^https?:\/\//, '').split('/')[0] ?? ''
                    ).split(':')[0] ?? ''
                const resolve4 = (name: string) =>
                    Effect.tryPromise({
                        try: () => dns.resolve4(name),
                        catch: (cause) => cause,
                    })

                // Step 1: system DNS.
                let resolvedIps: string[] = yield* resolve4(cleanDomain).pipe(
                    Effect.catch(() => Effect.succeed([] as string[]))
                )

                // Step 2: Google DNS-over-HTTPS, for cross-validation when the system resolver finds nothing.
                if (resolvedIps.length === 0) {
                    const query = new URL('https://dns.google/resolve')
                    query.searchParams.set('name', cleanDomain)
                    query.searchParams.set('type', 'A')
                    const resp = yield* this.fixedGet(query.toString(), [
                        'dns.google',
                    ])
                    if (resp !== null) {
                        const data = yield* Effect.try({
                            try: () =>
                                JSON.parse(
                                    new TextDecoder().decode(resp.body)
                                ) as { Answer?: { data?: unknown }[] },
                            catch: (cause) => cause,
                        }).pipe(
                            Effect.catch(() =>
                                Effect.succeed<{
                                    Answer?: { data?: unknown }[]
                                }>({})
                            )
                        )
                        resolvedIps = (data.Answer ?? []).flatMap((a) =>
                            typeof a.data === 'string' && isIP(a.data) !== 0
                                ? [a.data]
                                : []
                        )
                    }
                }

                // Step 3: does it match the expected address? (an IP, or a hostname resolved and compared by intersection)
                let dnsMatch: boolean | null = null
                if (expectedIp && resolvedIps.length > 0) {
                    const expected =
                        (
                            expectedIp
                                .replace(/^https?:\/\//, '')
                                .split('/')[0] ?? ''
                        ).split(':')[0] ?? ''
                    if (isIP(expected) !== 0) {
                        dnsMatch = resolvedIps.includes(expected)
                    } else {
                        const expectedIps = yield* resolve4(expected).pipe(
                            Effect.catch(() => Effect.succeed(null))
                        )
                        dnsMatch =
                            expectedIps === null
                                ? false
                                : expectedIps.some((ip) =>
                                      resolvedIps.includes(ip)
                                  )
                    }
                }

                const httpsStatus = yield* this.probeStatus(
                    'https',
                    cleanDomain,
                    8000
                )
                const httpStatusCode =
                    httpsStatus ??
                    (yield* this.probeStatus('http', cleanDomain, 5000))

                return {
                    domain: cleanDomain,
                    expectedIp,
                    resolvedIps,
                    dnsMatch,
                    httpReachable: httpStatusCode !== undefined,
                    httpStatusCode,
                    error:
                        resolvedIps.length === 0
                            ? 'Domain does not resolve to any IP'
                            : undefined,
                }
            })
        }

        /** One HEAD through the external policy, https first: the status, or `undefined` when it did not answer. */
        private probeStatus(
            scheme: 'https' | 'http',
            domain: string,
            timeoutMs: number
        ): Effect.Effect<number | undefined, never, EgressService> {
            return Effect.gen(function* () {
                const egress = yield* EgressService
                return yield* egress
                    .external(
                        { url: `${scheme}://${domain}`, method: 'HEAD' },
                        { timeoutMs }
                    )
                    .pipe(
                        Effect.map((resp) => resp.status),
                        Effect.catch(() => Effect.succeed(undefined))
                    )
            })
        }

        checkMeshUrlReachability(
            url: string
        ): ReturnType<ReachabilityServiceShape['checkMeshUrlReachability']> {
            return Effect.gen(function* () {
                const egress = yield* EgressService
                // The probe mechanics are the egress's generic primitive; which paths identify a node is this platform's convention.
                const result = yield* egress.probeOperatorPeer(
                    url,
                    '/mesh/ping',
                    '/health'
                )
                if (result.reachable) {
                    yield* Effect.logInfo(
                        `Mesh reachable at ${result.probeUrl} (${String(result.latencyMs)}ms)`
                    )
                } else {
                    yield* Effect.logWarning(
                        `Mesh unreachable at ${url}: ${result.error ?? 'unknown error'}`
                    )
                }
                return {
                    url,
                    reachable: result.reachable,
                    probeUrl: result.probeUrl,
                    latencyMs: result.latencyMs,
                    advertisedHost: result.identity?.advertisedHost,
                    version: result.identity?.version,
                    error: result.error,
                }
            })
        }
    }
}
