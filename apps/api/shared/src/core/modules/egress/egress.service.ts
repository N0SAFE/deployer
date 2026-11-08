import { Context, Duration, Effect, Layer } from 'effect'

import { domainError } from '@deployer/effect-core'
import {
    publicEgressMessage,
    SafeHttp,
    type EgressPolicy as Policy,
    type HttpReq,
    type HttpRes,
    type SafeHttpShape,
} from '@deployer/effect-infra'
import {
    probeAddress,
    probePeer,
    type AddressProbeResult,
    type PeerProbeResult,
} from '@deployer/effect-reachability'

import {
    resolveEgressPolicies,
    type EgressEnv,
    type EgressPolicies,
} from './egress-policy'

/**
 * What an outbound request fails with. `reason` is a CATEGORY ("Target not allowed by the network policy", "Timed out",
 * "Connection failed"), safe to hand back to a caller; the detail (the address a name resolved to, the transport error)
 * goes to the server log only (`cause` is never exposed). Otherwise a probe endpoint is an internal port scanner.
 */
export class EgressRequestError extends domainError(
    'EgressRequestError',
    'dependency_missing'
)<{
    readonly target: 'external' | 'operator' | 'fixedExternal'
    readonly reason: string
    /** What went wrong, for callers that map it to a status: refused by policy, timed out, or any other failure. */
    readonly failure: 'denied' | 'timeout' | 'failed'
}>() {
    override publicMessage() {
        return this.reason
    }
}

const failureOf = (error: unknown): EgressRequestError['failure'] => {
    const tag = (error as { _tag?: unknown } | undefined)?._tag
    return tag === 'EgressDenied'
        ? 'denied'
        : tag === 'HttpTimeout'
          ? 'timeout'
          : 'failed'
}

/** Per-call tuning that cannot widen the policy. */
export type RequestOptions = { readonly timeoutMs?: number }

export type EgressServiceShape = {
    readonly policies: EgressPolicies
    /** A user-chosen target: a custom domain, a deployed domain, an operator-declared public address. */
    readonly external: (
        req: HttpReq,
        options?: RequestOptions
    ) => Effect.Effect<HttpRes, EgressRequestError>
    /** An operator-typed target: a mesh peer or node address. */
    readonly operator: (
        req: HttpReq,
        options?: RequestOptions
    ) => Effect.Effect<HttpRes, EgressRequestError>
    /** A fixed third-party host the platform itself chose (public IP echo, DNS-over-HTTPS). */
    readonly fixedExternal: (
        req: HttpReq,
        hosts: readonly string[]
    ) => Effect.Effect<HttpRes, EgressRequestError>
    /** Run an Effect probe (`@deployer/effect-reachability`) with this service's `SafeHttp`. */
    readonly probe: <A>(
        effect: Effect.Effect<A, never, SafeHttp>
    ) => Effect.Effect<A>
    /** Probe a user-chosen address until one of `paths` answers 2xx. */
    readonly probeUserAddress: (
        address: string,
        paths: readonly string[],
        failureReason?: (value: string) => string
    ) => Effect.Effect<AddressProbeResult>
    /** Probe an operator-typed peer's identity endpoint, with a liveness fallback. */
    readonly probeOperatorPeer: (
        url: string,
        primaryPath: string,
        fallbackPath?: string
    ) => Effect.Effect<PeerProbeResult>
}

/**
 * Every outbound request whose target a user or operator influences goes through here (NET-004, SEC-013). It is the face
 * of the `SafeHttp` Effect layer: scheme and host allow-lists, resolve-once-then-connect-to-that-address (rebinding-safe),
 * per-hop redirect checks, a response size cap and a hard timeout.
 */
export class EgressService extends Context.Service<
    EgressService,
    EgressServiceShape
>()('shared/EgressService') {
    /**
     * A pure value: the policies come from the environment and the `SafeHttp`
     * is fixed at construction, so no member yields anything at call time.
     */
    static readonly live = class EgressServiceImpl
        implements EgressServiceShape
    {
        readonly policies: EgressPolicies
        private readonly layer: Layer.Layer<SafeHttp>

        constructor(
            /** The environment the policies are resolved from (production vs development allow-lists). */
            env: EgressEnv,
            /** The `SafeHttp` to send through; the real one (resolve-once-then-connect, redirect checks, size cap, timeout) by default. */
            http?: SafeHttpShape
        ) {
            this.policies = resolveEgressPolicies(env)
            this.layer =
                http === undefined
                    ? SafeHttp.layer
                    : Layer.succeed(SafeHttp, SafeHttp.of(http))
        }

        private send(
            target: EgressRequestError['target'],
            req: HttpReq,
            policy: Policy
        ): Effect.Effect<HttpRes, EgressRequestError> {
            const { layer } = this
            return Effect.gen(function* () {
                return yield* (yield* SafeHttp).request(req, policy)
            }).pipe(
                Effect.provide(layer),
                Effect.tapError((error) =>
                    // Detail for the operator, never for the caller.
                    Effect.logWarning(
                        `${target} request refused or failed (${req.method ?? 'GET'} ${safeUrl(req.url)}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
                    )
                ),
                Effect.mapError(
                    (error) =>
                        new EgressRequestError({
                            target,
                            reason: publicEgressMessage(error),
                            failure: failureOf(error),
                            cause: error,
                        })
                )
            )
        }

        /** A user-chosen target: a custom domain, a deployed domain, an operator-declared public address. */
        external(
            req: HttpReq,
            options?: RequestOptions
        ): Effect.Effect<HttpRes, EgressRequestError> {
            return this.send(
                'external',
                req,
                withTimeout(this.policies.external, options)
            )
        }

        /** An operator-typed target: a mesh peer or node address. */
        operator(
            req: HttpReq,
            options?: RequestOptions
        ): Effect.Effect<HttpRes, EgressRequestError> {
            return this.send(
                'operator',
                req,
                withTimeout(this.policies.operator, options)
            )
        }

        /** A fixed third-party host the platform itself chose (public IP echo, DNS-over-HTTPS). */
        fixedExternal(
            req: HttpReq,
            hosts: readonly string[]
        ): Effect.Effect<HttpRes, EgressRequestError> {
            return this.send(
                'fixedExternal',
                req,
                this.policies.fixedExternal(hosts)
            )
        }

        /** Run an Effect probe (`@deployer/effect-reachability`) with this service's `SafeHttp`. */
        probe<A>(effect: Effect.Effect<A, never, SafeHttp>): Effect.Effect<A> {
            return effect.pipe(Effect.provide(this.layer))
        }

        /** Probe a user-chosen address until one of `paths` answers 2xx. */
        probeUserAddress(
            address: string,
            paths: readonly string[],
            failureReason?: (value: string) => string
        ): Effect.Effect<AddressProbeResult> {
            return this.probe(
                probeAddress(address, {
                    policy: this.policies.external,
                    paths,
                    tryBothSchemes: true,
                    ...(failureReason === undefined ? {} : { failureReason }),
                })
            )
        }

        /** Probe an operator-typed peer's identity endpoint, with a liveness fallback. */
        probeOperatorPeer(
            url: string,
            primaryPath: string,
            fallbackPath?: string
        ): Effect.Effect<PeerProbeResult> {
            return this.probe(
                probePeer(url, {
                    policy: this.policies.operator,
                    primaryPath,
                    ...(fallbackPath === undefined ? {} : { fallbackPath }),
                })
            )
        }
    }
}

const withTimeout = (
    policy: Policy,
    options: RequestOptions | undefined
): Policy =>
    options?.timeoutMs === undefined
        ? policy
        : { ...policy, timeout: Duration.millis(options.timeoutMs) }

/** The URL for a log line without credentials or query string. */
const safeUrl = (raw: string): string => {
    try {
        const url = new URL(raw)
        return `${url.protocol}//${url.host}${url.pathname}`
    } catch {
        return '<invalid url>'
    }
}
