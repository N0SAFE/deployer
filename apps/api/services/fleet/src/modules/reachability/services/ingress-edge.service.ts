/**
 * IngressEdgeService — what the Network pages read and change: the lanes, the
 * public edge, the DNS records they need, and the mesh they ride on.
 *
 * Orchestration only — every decision has an owner elsewhere:
 *
 *   the lanes                   IngressLanesService     (replicated cluster setting)
 *   which edge, its rules       EdgeProviderRegistry    (validation, inbound-port consent)
 *   the edge itself             the EdgeProvider        (provision / teardown / status)
 *   the DNS records             EdgeDnsService          (separate plane from ingress)
 *   the ingress processes       TraefikConfigRefresherShape  (re-converge now, not next sweep)
 *   the mesh view               this node's agent, over its node door
 *
 * ── SWITCHING THE PUBLIC EDGE ───────────────────────────────────────────────
 * New edge first, lanes second, old edge last:
 *
 *   1. provision the new edge — if it cannot exist, nothing changes;
 *   2. write the lanes — Traefik, the connector and DNS follow them;
 *   3. tear the previous edge down (best effort — the lane no longer names it, so
 *      it carries nothing even if its provider is unreachable right now).
 *
 * Turning the public lane OFF always succeeds for the same reason: the lane is the
 * switch, the teardown is cleanup.
 */

import { Context, Effect } from "effect";

import {
	ingressExposure,
	ingressLanesSchema,
	joinEntryPoints,
	type IngressLanes,
	type PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";
import { bindServices, serviceOver, type Over } from "@deployer/effect-core";
import type { IngressState, UpdateIngressInput } from "@deployer/fleet-contracts/modules/reachability/contracts";
import type { NodeDoorClient, NodeDoorStatus, NodeDoorView } from "@deployer/mesh-client";
import type { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import type { HostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import type { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import type { PublicEdgeService } from "@deployer/shared/core/modules/reachability/services/public-edge.service";
import type { TraefikConfigRefresherShape } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";


import type { DnsProviderRegistryServices } from "@/modules/providers/dns/shared/dns-provider-registry.service";

import { attempt, attemptSync } from "../../../core/effects";
import { FleetInvalid } from "../../../core/fleet.errors";
import { NodeAgentUnsupported } from "../reachability.errors";
import {
	EdgeProvidersPort,
	HostnamesPort,
	IngressLanesPort,
	NodeAgentPort,
	PublicEdgePort,
	TraefikRefresherPort,
} from "../reachability.ports";

import { EdgeDnsService, type EdgeDnsServiceShape } from "./edge-dns.service";
import { planLaneDnsRecords } from "./lane-dns-plan";

/** Converge DNS on this cadence too: mesh addresses and public addresses change. */
export const DNS_RECONCILE_INTERVAL_MS = 10 * 60_000;

type MeshView = IngressState["mesh"];

/** A record name the public edge owned before a change, and the account it lived on. */
type RetiredDnsName = {
	name: string;
	accountId: string | null;
};

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A use case fails with a `FleetInvalid` refusal of its own, or with what a platform collaborator
 * refused with (left as thrown; `serve` lets it through for the host to translate).
 */
/**
 * What the ingress edge reads from the Effect context while it runs.
 */
export type IngressEdgePorts =
	| IngressLanesPort
	| EdgeProvidersPort
	| PublicEdgePort
	| NodeAgentPort
	| HostnamesPort
	| TraefikRefresherPort
	| EdgeDnsService
	| DnsProviderRegistryServices;

export type IngressEdgeServiceShape = {
	readonly getState: () => Effect.Effect<IngressState, unknown, IngressEdgePorts>;
	/** Apply a partial lanes change; only the fields sent change. */
	readonly update: (input: UpdateIngressInput) => Effect.Effect<IngressState, unknown, IngressEdgePorts>;
	/** Delete everything the public edge created, then turn the public lane off. */
	readonly teardownPublicEdge: () => Effect.Effect<IngressState, unknown, IngressEdgePorts>;
	/** Revoke a mesh member from this node's agent; every member drops it on the next gossip round. */
	readonly revokeMeshMember: (memberId: string, reason: string) => Effect.Effect<IngressState, unknown, IngressEdgePorts>;
	/** Converge the DNS records the lanes need. Never fails. */
	readonly reconcileDns: (retired?: readonly RetiredDnsName[]) => Effect.Effect<void, never, IngressEdgePorts>;
};

type Ports = {
	readonly lanes: IngressLanesService;
	readonly edges: EdgeProviderRegistry;
	readonly publicEdge: PublicEdgeService;
	readonly mesh: NodeDoorClient;
	readonly hostnames: HostnameService;
	readonly refresher: TraefikConfigRefresherShape;
	readonly dns: EdgeDnsServiceShape;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class IngressEdgeService extends Context.Service<
	IngressEdgeService,
	Over<IngressEdgeServiceShape, IngressEdgePorts>
>()(
	"fleet/IngressEdgeService",
) {
	/**
	 * The ports are yielded when a method runs, so this is a constant the module provides with `useValue`.
	 * The periodic DNS reconcile is `startIngressDnsReconciler`'s job: a constant has no lifetime of its own.
	 */
	static readonly live = serviceOver(
		Effect.gen(function* () {
			const lanes = yield* IngressLanesPort;
			const edges = yield* EdgeProvidersPort;
			const publicEdge = yield* PublicEdgePort;
			const mesh = yield* NodeAgentPort;
			const hostnames = yield* HostnamesPort;
			const refresher = yield* TraefikRefresherPort;
			// The DNS service reads its own registry from the context; hand it over with that settled.
			const dns = bindServices(yield* EdgeDnsService, yield* Effect.context<DnsProviderRegistryServices>());
			return { lanes, edges, publicEdge, mesh, hostnames, refresher, dns };
		}),
		makeIngressEdgeService,
	);

}

/**
 * The fleet contract's mesh view, built from what the node door actually knows.
 *
 * The door knows nodes (id, address, overlay identity), the kernel's peer handshakes, and nothing else: there is no
 * cluster id, no advertised CIDR, no door inventory, no gossip clock and no per-member signing key on this agent. Those
 * fields stay `null`/empty — a fabricated cluster id would be worse than an absent one.
 *
 * `link.path` has no "unknown" member: a peer the kernel holds with no handshake yet is `passive` ("it must dial us"),
 * which is exactly what a missing handshake means.
 */
function toMeshView(status: NodeDoorStatus | null, view: NodeDoorView | null): MeshView {
	const peers = status?.peers ?? [];
	return {
		available: view !== null,
		clusterId: null,
		cidr: null,
		address: status?.meshAddress ?? view?.self.overlay?.meshAddress ?? null,
		listenPort: status?.listenPort ?? view?.self.overlay?.listenPort ?? null,
		interfaceUp: status?.interfaceUp ?? false,
		members: (view?.agents ?? []).map((agent) => {
			const peer = peers.find((candidate) => candidate.nodeId === agent.nodeId) ?? null;
			const self = agent.nodeId === view?.self.nodeId;
			return {
				memberId: agent.nodeId,
				name: agent.nodeId,
				kind: "node" as const,
				// Its overlay address is what other nodes reach it on; the roster address is where its agent answers.
				address: agent.overlay?.meshAddress ?? agent.address,
				state: "active" as const,
				self,
				labels: { ...agent.labels },
				endpoints: [{ kind: "declared", address: agent.address }],
				link: {
					path: self ? ("self" as const) : peer?.latestHandshakeAt != null ? ("direct" as const) : ("passive" as const),
					endpoint: peer?.endpoint ?? agent.overlay?.endpoint ?? null,
					latestHandshakeAt: peer?.latestHandshakeAt == null ? null : new Date(peer.latestHandshakeAt).toISOString(),
				},
			};
		}),
		doors: [],
		lastGossipAt: null,
		lastError: view === null ? "This node's mesh agent did not answer." : null,
	};
}

function makeIngressEdgeService(ports: Ports): IngressEdgeServiceShape {
	const { lanes: lanesPort, edges, publicEdge, mesh, hostnames, refresher, dns } = ports;

	const consoleUrls = (lanes: IngressLanes): IngressState["consoleUrls"] => {
		const port = lanes.entryPort === 80 ? "" : `:${String(lanes.entryPort)}`;
		const publicLane = lanes.public;
		const scheme = edges.ingressPlan(lanes).tls === "none" ? "http" : "https";
		return {
			local: `${hostnames.webOrigin()}${port}`,
			private: lanes.private.enabled ? `http://web.${lanes.private.domain}${port}` : null,
			public: publicLane !== null && lanes.consoleVisibility === "public" ? `${scheme}://web.${publicLane.domain}` : null,
		};
	};

	/**
	 * What this node's agent answers on its door: the kernel's view of the interface (`status`) and the roster it
	 * knows (`view`). Both are null when the node runs no new agent — that is "no agent", not an error.
	 */
	const readDoor = (): Effect.Effect<readonly [NodeDoorStatus | null, NodeDoorView | null], unknown> =>
		Effect.all([attempt(() => mesh.status()), attempt(() => mesh.view())], { concurrency: "unbounded" });

	/** The mesh as this node sees it; an unreachable agent is reported, not raised. */
	const meshView: Effect.Effect<MeshView> = readDoor().pipe(
		Effect.map(([status, view]) => toMeshView(status, view)),
		Effect.catch((error) =>
			Effect.succeed<MeshView>({
				available: false,
				clusterId: null,
				cidr: null,
				address: null,
				listenPort: null,
				interfaceUp: false,
				members: [],
				doors: [],
				lastGossipAt: null,
				lastError: describe(error),
			}),
		),
	);

	const getState = Effect.fn("IngressEdgeService.getState")(function* () {
		const lanes = yield* attempt(() => lanesPort.getLanes());
		const [mesh_, edge, publicPath] = yield* Effect.all(
			[meshView, attempt(() => publicEdge.view(lanes)), attempt(() => publicEdge.joinPath(lanes))],
			{ concurrency: "unbounded" },
		);
		const state: IngressState = {
			lanes,
			exposure: ingressExposure(lanes, edge?.provider ?? null),
			domains: {
				local: hostnames.localDomain(),
				private: lanes.private.enabled ? lanes.private.domain : null,
				public: lanes.public?.domain ?? null,
			},
			consoleUrls: consoleUrls(lanes),
			edge: { providers: edges.descriptors(), active: edge },
			dns: yield* dns.results(),
			mesh: mesh_,
			// Counts NODE members only: an operator laptop is a member but serves no entry.
			entryPoints: joinEntryPoints({
				lanes,
				memberCount: mesh_.members.filter((member) => member.kind === "node" && member.state === "active").length,
				publicPath,
			}),
		};
		return state;
	});

	/** The names the current public edge owns: candidates for removal after a change. */
	const retiredNames = (lanes: IngressLanes): Effect.Effect<RetiredDnsName[]> =>
		attempt(() => publicEdge.dnsRecords(lanes)).pipe(
			Effect.map((records) => records.map((record) => ({ name: record.name, accountId: record.preferredAccountId }))),
			Effect.orElseSucceed((): RetiredDnsName[] => []),
		);

	const teardownProvider = (providerId: string, strict: boolean): Effect.Effect<void, unknown> => {
		const provider = edges.find(providerId);
		if (provider === null) return Effect.void;
		return attempt(() => provider.teardown()).pipe(
			Effect.catch((error) =>
				strict
					? Effect.fail(error)
					: Effect.logWarning(
							`${provider.descriptor.label} not torn down (it no longer carries the public lane): ${describe(error)}`,
						),
			),
		);
	};

	/**
	 * The requested public lane, validated against its provider. Options sent for the SAME provider
	 * replace the current ones; omitted options keep them, so toggling the domain does not require
	 * re-sending the account.
	 */
	const toPublicLane = (
		input: NonNullable<UpdateIngressInput["public"]> | null,
		current: PublicLane | null,
	): Effect.Effect<PublicLane | null, unknown> => {
		if (input === null) return Effect.succeed(null);
		const sameProvider = current?.provider === input.provider;
		return attemptSync(() =>
			edges.normalize({
				provider: input.provider,
				domain: input.domain,
				acknowledgedInboundPorts: input.acknowledgedInboundPorts ?? (sameProvider ? current.acknowledgedInboundPorts : false),
				options: input.options ?? (sameProvider ? current.options : {}),
			}),
		);
	};

	const reconcileDns = Effect.fn("IngressEdgeService.reconcileDns")(function* (retired: readonly RetiredDnsName[] = []) {
		yield* Effect.gen(function* () {
			const lanes = yield* attempt(() => lanesPort.getLanes());
			const [, view] = yield* readDoor().pipe(
				Effect.orElseSucceed((): readonly [NodeDoorStatus | null, NodeDoorView | null] => [null, null]),
			);
			// A private-lane A record needs an IP, so only nodes with an overlay contribute one.
			const meshAddresses = (view?.agents ?? []).flatMap((agent) =>
				agent.overlay === null ? [] : [agent.overlay.meshAddress],
			);
			const publicEdgeRecords = yield* attempt(() => publicEdge.dnsRecords(lanes));
			const plans = planLaneDnsRecords(lanes, { publicEdgeRecords, meshAddresses });
			const planned = new Set(plans.map((plan) => plan.name.toLowerCase()));
			for (const old of retired) {
				if (!planned.has(old.name.toLowerCase())) yield* dns.removeRecords(old.name, old.accountId);
			}
			yield* dns.reconcile(plans);
		}).pipe(Effect.catch((error) => Effect.logWarning(`DNS reconcile skipped: ${describe(error)}`)));
	});

	return {
		getState,
		reconcileDns,

		update: Effect.fn("IngressEdgeService.update")(function* (input) {
			const current = yield* attempt(() => lanesPort.getLanes());
			const next: IngressLanes = {
				entryPort: input.entryPort ?? current.entryPort,
				private:
					input.private === undefined
						? current.private
						: {
								enabled: input.private.enabled,
								domain: input.private.domain ?? current.private.domain,
								exposeOnLan: input.private.exposeOnLan ?? current.private.exposeOnLan,
							},
				public: input.public === undefined ? current.public : yield* toPublicLane(input.public, current.public),
				consoleVisibility: input.consoleVisibility ?? current.consoleVisibility,
			};
			const parsed = ingressLanesSchema.safeParse(next);
			if (!parsed.success) return yield* new FleetInvalid({ reason: `Invalid lanes: ${parsed.error.message}` });
			const lanes = parsed.data;

			const retired = yield* retiredNames(current);

			// 1. The new edge must exist before the lanes claim it.
			if (lanes.public !== null) {
				const resolved = yield* attempt(() => publicEdge.resolve(lanes));
				if (resolved === null) {
					return yield* new FleetInvalid({ reason: `Unknown edge provider '${lanes.public.provider}'` });
				}
				yield* attempt(() => resolved.provider.provision(resolved.ctx));
			}
			// 2. The switch.
			yield* attempt(() => lanesPort.setLanes(lanes));
			// 3. The old edge carries nothing any more; clean it up.
			if (current.public !== null && current.public.provider !== lanes.public?.provider) {
				yield* teardownProvider(current.public.provider, false);
			}

			yield* reconcileDns(retired);
			refresher.refresh();
			return yield* getState();
		}),

		teardownPublicEdge: Effect.fn("IngressEdgeService.teardownPublicEdge")(function* () {
			const lanes = yield* attempt(() => lanesPort.getLanes());
			if (lanes.public === null) return yield* getState();
			const retired = yield* retiredNames(lanes);
			// Explicit request: a provider failure is reported, not swallowed.
			yield* teardownProvider(lanes.public.provider, true);
			yield* attempt(() => lanesPort.setLanes({ ...lanes, public: null }));
			yield* reconcileDns(retired);
			refresher.refresh();
			return yield* getState();
		}),

		revokeMeshMember: Effect.fn("IngressEdgeService.revokeMeshMember")(function* (memberId, reason) {
			const [, view] = yield* readDoor();
			if (view === null) {
				return yield* new NodeAgentUnsupported({
					reason: "This node's mesh agent did not answer, so it cannot revoke a member.",
				});
			}
			if (view.self.nodeId === memberId) {
				return yield* new FleetInvalid({
					reason: "A node cannot revoke itself. Revoke it from another member's console.",
				});
			}
			if (!view.agents.some((agent) => agent.nodeId === memberId)) {
				return yield* new FleetInvalid({ reason: `No mesh member ${memberId}` });
			}
			// The agent stops trusting the node: its agents and replicas are dropped from the roster and cannot be learned
			// again until unblocked. `reason` stays in the caller's audit trail, not in the agent's store.
			const blocked = yield* attempt(() => mesh.blockNode(memberId));
			if (blocked === null) {
				return yield* new NodeAgentUnsupported({
					reason: `Cannot revoke ${memberId} (${reason}): the node door did not answer.`,
				});
			}
			return yield* getState();
		}),
	};
}
