import type { EgressService } from "@deployer/shared/core/modules/egress/egress.service";
import type { NodeNetworkConfigData } from "@deployer/shared/core/modules/reachability/services/node-network-config.mapper";
import type { PublicAccessPointService } from "@deployer/shared/core/modules/reachability/services/public-access-point.service";
import type { ReachabilityService } from "@deployer/shared/core/modules/reachability/services/reachability.service";
import type { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import { Context, Effect, Layer } from "effect";
import { Observable } from "rxjs";

import { attempt, attemptSync } from "../../../core/effects";
import {
	EgressPort,
	PublicAccessPointPort,
	ReachabilityCorePort,
	TraefikRefresherPort,
} from "../reachability.ports";

/** A node's own network config as the contract sees it (the public edge belongs to the stack). */
type NodeNetworkView = NodeNetworkConfigData;

/** What the shared services answer, so this layer's types follow them rather than restate them. */
type DomainCheck = Awaited<ReturnType<ReachabilityService["checkDomainReachability"]>>;
type DomainGate = Awaited<ReturnType<ReachabilityService["checkDomainGate"]>>;
type AccessPointState = Awaited<ReturnType<PublicAccessPointService["getAccessPoint"]>>;
type NodeConfigUpdate = Parameters<ReachabilityService["updateNodeNetworkConfig"]>[0];

/** Live availability of the stack's public URL. */
type PublicUrlProbe = {
	publicUrl: string | null;
	lastCheckedAt: string | null;
	lastStatus: string | null;
	reachable: boolean | null;
};

const describe = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * What the Network pages ask about reachability: is a URL up, what is this node's public address,
 * may a domain be used yet. A probe never fails: an unreachable URL is the answer, not an error.
 * The calls that read or write shared state fail with whatever the platform service refused with.
 */
export type NodeReachabilityServiceShape = {
	/** Probe a URL through the operator egress policy; failures are reported as a category. */
	readonly check: (url: string) => Effect.Effect<{
		url: string;
		reachable: boolean;
		latencyMs: number;
		statusCode?: number;
		error?: string;
	}>;
	/**
	 * The stack's public URL, live. The URL is derived and never stored, so `getConfig` and
	 * `updateConfig` are the same question and must not drift apart.
	 */
	readonly probePublicUrl: () => Effect.Effect<PublicUrlProbe, unknown>;
	readonly checkDomain: (domain: string, expectedIp?: string) => Effect.Effect<DomainCheck, unknown>;
	readonly getPublicIp: () => Effect.Effect<{ ip: string | null }, unknown>;
	readonly getNodeNetworkConfig: (
		nodeId: Parameters<ReachabilityService["getNodeNetworkConfig"]>[0],
	) => Effect.Effect<NodeNetworkView, unknown>;
	readonly listNodeNetworkConfigs: () => Effect.Effect<{ configs: NodeNetworkView[] }, unknown>;
	/** Changing a node's address makes Traefik publish the new Host rule: re-converge now. */
	readonly updateNodeNetworkConfig: (input: NodeConfigUpdate) => Effect.Effect<NodeNetworkView, unknown>;
	readonly checkDomainGate: () => Effect.Effect<
		Pick<DomainGate, "allowed" | "reason" | "publicAddress" | "addressKind">,
		unknown
	>;
	/** Request, live re-check, push onto the global relay, return the fresh state. */
	readonly getPublicAccessPoint: () => Effect.Effect<AccessPointState, unknown>;
	/** Emits the current state and every subsequent push. */
	readonly watchPublicAccessPoint: () => Effect.Effect<Observable<AccessPointState>, unknown>;
};

type Ports = {
	readonly reachability: ReachabilityService;
	readonly accessPoint: PublicAccessPointService;
	readonly egress: EgressService;
	readonly refresher: TraefikConfigRefresher;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class NodeReachabilityService extends Context.Service<NodeReachabilityService, NodeReachabilityServiceShape>()(
	"fleet/NodeReachabilityService",
) {
	static readonly Live: Layer.Layer<
		NodeReachabilityService,
		never,
		ReachabilityCorePort | PublicAccessPointPort | EgressPort | TraefikRefresherPort
	> = Layer.effect(
		NodeReachabilityService,
		Effect.gen(function* () {
			return makeNodeReachabilityService({
				reachability: yield* ReachabilityCorePort,
				accessPoint: yield* PublicAccessPointPort,
				egress: yield* EgressPort,
				refresher: yield* TraefikRefresherPort,
			});
		}),
	);
}

const toNodeNetworkView = (config: NodeNetworkConfigData): NodeNetworkView => ({
	nodeId: config.nodeId,
	publicAddress: config.publicAddress,
	addressKind: config.addressKind,
	updatedAt: config.updatedAt,
});

export function makeNodeReachabilityService({ reachability, accessPoint, egress, refresher }: Ports): NodeReachabilityServiceShape {
	const isOk = (status: number) => status >= 200 && status < 300;

	const probePublicUrl = Effect.fn("NodeReachabilityService.probePublicUrl")(function* () {
		const publicUrl = yield* attempt(() => reachability.getNodePublicUrl());
		if (!publicUrl) return { publicUrl: null, lastCheckedAt: null, lastStatus: null, reachable: null };
		return yield* attempt(() => egress.operator({ url: `${publicUrl}/health` })).pipe(
			Effect.map(
				(resp): PublicUrlProbe => ({
					publicUrl,
					lastCheckedAt: new Date().toISOString(),
					lastStatus: isOk(resp.status) ? "reachable" : `http_${String(resp.status)}`,
					reachable: isOk(resp.status),
				}),
			),
			Effect.catch((err) =>
				Effect.succeed<PublicUrlProbe>({
					publicUrl,
					lastCheckedAt: new Date().toISOString(),
					lastStatus: describe(err, "unreachable"),
					reachable: false,
				}),
			),
		);
	});

	return {
		check: Effect.fn("NodeReachabilityService.check")(function* (url) {
			const probeUrl = `${url.replace(/\/$/, "")}/mesh/ping`;
			const start = Date.now();
			// Any authenticated user can name this URL: it goes through the operator egress policy
			// (no loopback / link-local / metadata, no redirects) and failures are reported as a
			// category, never as a resolved address or a transport error.
			return yield* attempt(() => egress.operator({ url: probeUrl })).pipe(
				Effect.map((resp) => ({
					url,
					reachable: isOk(resp.status),
					latencyMs: Date.now() - start,
					statusCode: resp.status,
					error: isOk(resp.status) ? undefined : `HTTP ${String(resp.status)}`,
				})),
				Effect.catch((err) =>
					Effect.succeed({
						url,
						reachable: false,
						latencyMs: Date.now() - start,
						error: describe(err, "Connection failed"),
					}),
				),
			);
		}),

		probePublicUrl,

		checkDomain: Effect.fn("NodeReachabilityService.checkDomain")(function* (domain, expectedIp) {
			return yield* attempt(() => reachability.checkDomainReachability(domain, expectedIp));
		}),

		getPublicIp: Effect.fn("NodeReachabilityService.getPublicIp")(function* () {
			return { ip: yield* attempt(() => reachability.getPublicIp()) };
		}),

		getNodeNetworkConfig: Effect.fn("NodeReachabilityService.getNodeNetworkConfig")(function* (nodeId) {
			return toNodeNetworkView(yield* attempt(() => reachability.getNodeNetworkConfig(nodeId)));
		}),

		listNodeNetworkConfigs: Effect.fn("NodeReachabilityService.listNodeNetworkConfigs")(function* () {
			const configs = yield* attempt(() => reachability.listNodeNetworkConfigs());
			return { configs: configs.map(toNodeNetworkView) };
		}),

		updateNodeNetworkConfig: Effect.fn("NodeReachabilityService.updateNodeNetworkConfig")(function* (input) {
			const updated = yield* attempt(() => reachability.updateNodeNetworkConfig(input));
			refresher.refresh();
			return toNodeNetworkView(updated);
		}),

		checkDomainGate: Effect.fn("NodeReachabilityService.checkDomainGate")(function* () {
			const gate = yield* attempt(() => reachability.checkDomainGate());
			return {
				allowed: gate.allowed,
				reason: gate.reason,
				publicAddress: gate.publicAddress,
				addressKind: gate.addressKind,
			};
		}),

		getPublicAccessPoint: Effect.fn("NodeReachabilityService.getPublicAccessPoint")(function* () {
			const state = yield* attempt(() => accessPoint.getAccessPoint());
			yield* Effect.logInfo(
				`Public access point requested: kind=${String(state.kind)} url=${state.publicUrl ?? "none"} reachable=${String(state.reachable)}`,
			);
			return state;
		}),

		watchPublicAccessPoint: Effect.fn("NodeReachabilityService.watchPublicAccessPoint")(function* () {
			return yield* attemptSync(
				() =>
					new Observable<AccessPointState>((subscriber) => {
						const sub = accessPoint.watchAccessPoint().subscribe({
							next: (state) => {
								subscriber.next(state);
							},
							error: (err) => {
								subscriber.error(err);
							},
						});
						return () => {
							sub.unsubscribe();
						};
					}),
			);
		}),
	};
}
