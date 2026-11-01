import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
	makeSafeHttpClient,
	publicEgressMessage,
        SafeHttp,
        type EgressPolicy as Policy,
        type HttpReq,
        type HttpRes,
        type SafeHttpClient,
} from "@deployer/effect-infra";
import { probeAddress, probePeer, type AddressProbeResult, type PeerProbeResult } from "@deployer/effect-reachability";
import { Duration, Effect } from "effect";

import { resolveEgressPolicies, type EgressEnv, type EgressPolicies } from "./egress-policy";

/** Test seams: Nest injects nothing for these in production, so the real environment and client are used. */
export const EGRESS_ENV = Symbol("EGRESS_ENV");
export const EGRESS_HTTP_CLIENT = Symbol("EGRESS_HTTP_CLIENT");

/**
 * What an outbound probe throws. The message is a CATEGORY ("Target not allowed by the network
 * policy", "Timed out", "Connection failed"), safe to hand back to a caller; the detail (the
 * address a name resolved to, the transport error) goes to the server log only. Otherwise a probe
 * endpoint is an internal port scanner.
 */
export class EgressRequestError extends Error {
	/** What went wrong, for callers that map it to a status: refused by policy, timed out, or any other failure. */
	readonly failure: "denied" | "timeout" | "failed";

	constructor(
		message: string,
		readonly kind: "external" | "operator" | "fixedExternal",
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "EgressRequestError";
		const tag = (options?.cause as { _tag?: unknown } | undefined)?._tag;
		this.failure = tag === "EgressDenied" ? "denied" : tag === "HttpTimeout" ? "timeout" : "failed";
	}
}

/**
 * Every outbound request whose target a user or operator influences goes through here
 * (NET-004, SEC-013). It is the Nest-side face of the `SafeHttp` Effect layer: scheme and host
 * allow-lists, resolve-once-then-connect-to-that-address (rebinding-safe), per-hop redirect
 * checks, a response size cap and a hard timeout. It becomes a plain `SafeHttp` dependency when
 * its callers become Effect services.
 */
@Injectable()
export class EgressService {
	private readonly logger = new Logger(EgressService.name);
	private readonly client: SafeHttpClient;
	readonly policies: EgressPolicies;

	constructor(
		@Optional() @Inject(EGRESS_ENV) env?: EgressEnv,
		@Optional() @Inject(EGRESS_HTTP_CLIENT) client?: SafeHttpClient,
	) {
		this.policies = resolveEgressPolicies(env ?? process.env);
		this.client = client ?? makeSafeHttpClient();
		this.logger.log(`Egress policy: ${this.policies.summary}`);
	}

	/** A user-chosen target: a custom domain, a deployed domain, an operator-declared public address. */
	external(req: HttpReq, options?: RequestOptions): Promise<HttpRes> {
		return this.send("external", req, withTimeout(this.policies.external, options));
	}

	/** An operator-typed target: a mesh peer or node address. */
	operator(req: HttpReq, options?: RequestOptions): Promise<HttpRes> {
		return this.send("operator", req, withTimeout(this.policies.operator, options));
	}

	/** A fixed third-party host the platform itself chose (public IP echo, DNS-over-HTTPS). */
	fixedExternal(req: HttpReq, hosts: readonly string[]): Promise<HttpRes> {
		return this.send("fixedExternal", req, this.policies.fixedExternal(hosts));
	}

        /**
         * Run an Effect probe against this service's egress policy.
         *
         * The probe itself is Effect-native (`@deployer/effect-reachability`); running it here keeps
         * the Promise↔Effect edge in ONE place, so a Nest caller does not rebuild the layer or the
         * error mapping every time. It becomes a `yield* SafeHttp` in the caller once these classes
         * are Effect services.
         */
        probe<A>(effect: Effect.Effect<A, never, SafeHttp>): Promise<A> {
                return Effect.runPromise(effect.pipe(Effect.provide(SafeHttp.layer)));
        }

        /** Probe a user-chosen address until one of `paths` answers 2xx. */
        probeUserAddress(
                address: string,
                paths: readonly string[],
                failureReason?: (value: string) => string,
        ): Promise<AddressProbeResult> {
                return this.probe(
                        probeAddress(address, {
                                policy: this.policies.external,
                                paths,
                                tryBothSchemes: true,
                                ...(failureReason === undefined ? {} : { failureReason }),
                        }),
                );
        }

        /** Probe an operator-typed peer's identity endpoint, with a liveness fallback. */
        probeOperatorPeer(
                url: string,
                primaryPath: string,
                fallbackPath?: string,
        ): Promise<PeerProbeResult> {
                return this.probe(
                        probePeer(url, {
                                policy: this.policies.operator,
                                primaryPath,
                                ...(fallbackPath === undefined ? {} : { fallbackPath }),
                        }),
                );
        }

	private async send(kind: EgressRequestError["kind"], req: HttpReq, policy: Policy): Promise<HttpRes> {
		try {
			return await this.client.request(req, policy);
		} catch (error) {
			// Detail for the operator, never for the caller.
			this.logger.warn(`${kind} request refused or failed (${req.method ?? "GET"} ${safeUrl(req.url)}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
			throw new EgressRequestError(publicEgressMessage(error), kind, { cause: error });
		}
	}
}

/** Per-call tuning that cannot widen the policy. */
export type RequestOptions = { readonly timeoutMs?: number };

const withTimeout = (policy: Policy, options: RequestOptions | undefined): Policy =>
	options?.timeoutMs === undefined ? policy : { ...policy, timeout: Duration.millis(options.timeoutMs) };

/** The URL for a log line without credentials or query string. */
const safeUrl = (raw: string): string => {
	try {
		const url = new URL(raw);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return "<invalid url>";
	}
};
