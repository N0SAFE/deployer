import {
	swarmConfigViewSchema,
	swarmParticipationInputSchema,
	swarmParticipationIssues,
	swarmParticipationSchema,
	type ClusterSnapshot,
	type SwarmConfigView,
	type SwarmInitOptions,
	type SwarmParticipationConfig,
	type SwarmParticipationInput,
} from "@deployer/contracts-entities";
import { DockerEngine, resolveSwarmNodeRole, type DockerEngineShape, type DockerError } from "@deployer/docker";
import {
	ClusterNodeRepository,
	NodeConfigRepository,
	platformRoleForPolicy,
	withIngress,
	withPlatformRole,
	type ClusterNodeRepositoryShape,
	type LocalDatabaseError,
	type NodeConfigRepositoryShape,
	type NodeStateConflict,
} from "@deployer/node-state";
import { Context, Effect, Layer } from "effect";

import { SwarmParticipationDefaultsService, type SwarmParticipationDefaults } from "../config";
import { SwarmCluster, type SwarmClusterShape } from "../cluster/swarm-cluster";
import { SwarmInvalid, type SwarmTimeout, type SwarmUnavailable } from "../errors";
import { POLICY_DOCUMENTS } from "./policy-documents";

type Policy = SwarmParticipationConfig["policy"];
export type ParticipationError = SwarmInvalid | SwarmUnavailable | SwarmTimeout | DockerError | LocalDatabaseError | NodeStateConflict;

export type SwarmParticipationShape = {
	/** Persisted choice (setup wizard / cluster UI), else the first-run defaults, else the schema defaults. */
	readonly effectiveConfig: () => Effect.Effect<SwarmParticipationConfig, LocalDatabaseError>;
	/** True once setup completed: the swarm decision is made at setup. */
	readonly setupDone: () => Effect.Effect<boolean, LocalDatabaseError>;
	/**
	 * Converges the local engine to the participation config, then applies the node policy. Idempotent:
	 * an engine that is already active only has the policy re-applied and the snapshot persisted.
	 *
	 * The branches are exhaustive and never turn one mode into another: an active cluster gets the
	 * policy only (a live cluster is never torn down); `join` joins, and a missing token or address is a
	 * loud failure, never a silent `swarm init`; `create` founds a new cluster.
	 */
	readonly converge: () => Effect.Effect<ClusterSnapshot, ParticipationError>;
	/** This node's mesh address, or null when it has none yet. Never fails. */
	readonly meshAddress: () => Effect.Effect<string | null>;
	/** Persists a participation change and converges at once when the platform is already set up. */
	readonly applyConfig: (input: SwarmParticipationInput) => Effect.Effect<SwarmConfigView, ParticipationError>;
	/** The read-model the UI renders. */
	readonly view: () => Effect.Effect<SwarmConfigView, LocalDatabaseError>;
};

/** The swarm DECISION layer: how THIS node participates in the cluster, decided at setup and editable later. */
export class SwarmParticipation extends Context.Service<SwarmParticipation, SwarmParticipationShape>()("swarm/SwarmParticipation") {
	static readonly layer: Layer.Layer<
		SwarmParticipation,
		never,
		SwarmParticipationDefaultsService | NodeConfigRepository | ClusterNodeRepository | SwarmCluster | DockerEngine
	> = Layer.effect(
		SwarmParticipation,
		Effect.gen(function* () {
			return makeSwarmParticipation({
				defaults: yield* SwarmParticipationDefaultsService,
				nodeConfig: yield* NodeConfigRepository,
				clusterNode: yield* ClusterNodeRepository,
				cluster: yield* SwarmCluster,
				docker: yield* DockerEngine,
			});
		}),
	);
}

const roleNoun = (role: string, cfg: SwarmParticipationConfig): string => {
	if (cfg.policy === "worker" || role === "worker") return "worker";
	return role === "manager" ? "manager" : "node";
};

export function makeSwarmParticipation(deps: {
	readonly defaults: SwarmParticipationDefaults;
	readonly nodeConfig: NodeConfigRepositoryShape;
	readonly clusterNode: ClusterNodeRepositoryShape;
	readonly cluster: SwarmClusterShape;
	readonly docker: DockerEngineShape;
}): SwarmParticipationShape {
	const { defaults, nodeConfig, clusterNode, cluster, docker } = deps;

	const effectiveConfig: SwarmParticipationShape["effectiveConfig"] = () =>
		nodeConfig.find().pipe(
			Effect.map((row) => {
				const persisted = row?.swarmConfig ?? null;
				return swarmParticipationSchema.parse({
					mode: persisted?.mode ?? defaults.mode ?? "create",
					policy: persisted?.policy ?? defaults.policy ?? "auto",
					advertiseAddr: persisted?.advertiseAddr ?? defaults.advertiseAddr ?? null,
					joinToken: persisted?.joinToken ?? defaults.joinToken ?? null,
					joinAddrs: persisted && persisted.joinAddrs.length > 0 ? persisted.joinAddrs : (defaults.joinAddrs ?? []),
				});
			}),
		);

	const setupDone: SwarmParticipationShape["setupDone"] = () =>
		nodeConfig.find().pipe(Effect.map((config) => config?.setupState === "setup_done" && Boolean(config.configuredAt)));

	const meshAddress: SwarmParticipationShape["meshAddress"] = () =>
		(defaults.meshAddress ?? Effect.succeed(null)).pipe(
			Effect.map((address) => address ?? null),
			Effect.catch(() => Effect.succeed(null)),
		);

	/**
	 * Init options bound to the mesh. With a mesh address, Swarm listens, advertises and carries VXLAN
	 * there, so nothing of the control or data plane binds a public interface. Without one (a lone node,
	 * no mesh yet) everything binds loopback: reachable from this node, unreachable from anywhere else,
	 * and re-anchored onto the mesh the first time a joiner needs it.
	 */
	const initOptions = (cfg: SwarmParticipationConfig): Effect.Effect<SwarmInitOptions> =>
		meshAddress().pipe(
			Effect.map((mesh) => ({
				ListenAddr: `${mesh ?? "127.0.0.1"}:2377`,
				AdvertiseAddr: `${cfg.advertiseAddr ?? defaults.advertiseAddr ?? mesh ?? "127.0.0.1"}:2377`,
				...(mesh === null ? {} : { DataPathAddr: mesh }),
			})),
		);

	/**
	 * The policy actually applied, defending two invariants even for legacy or env-derived configs:
	 * a node that FOUNDED the cluster is its only manager, so `worker` would leave the swarm with no
	 * manager (clamped to `auto`), and a cluster whose only manager is this node can never be drained.
	 */
	const policyFor = (cfg: SwarmParticipationConfig, snapshot: ClusterSnapshot): Effect.Effect<Policy> =>
		Effect.gen(function* () {
			if (cfg.mode === "create" && cfg.policy === "worker") {
				yield* Effect.logWarning(
					"Swarm policy 'worker' is impossible for a founding node (it would leave the new cluster with no manager) — using 'auto' instead",
				);
				return "auto" as const;
			}
			if (cfg.policy === "manager" && snapshot.managerCount <= 1) {
				yield* Effect.logWarning(
					`Swarm policy 'manager' (dedicated, drained) is impossible while this node is the only manager (managers=${String(snapshot.managerCount)}) — using 'auto' instead`,
				);
				return "auto" as const;
			}
			return cfg.policy;
		});

	/** Role (manager/worker), availability (active for mixed/worker, drain for a dedicated master) and the ingress label on managers. */
	const applyPolicy = (snapshot: ClusterSnapshot, policy: Policy): Effect.Effect<void> =>
		Effect.gen(function* () {
			const engineNodeId = snapshot.localNode.nodeId;
			if (engineNodeId === "unknown" || engineNodeId === "") {
				return yield* Effect.logWarning("Cannot apply swarm policy — local engine node id unknown");
			}
			const desired =
				policy === "worker"
					? { role: "worker" as const, availability: "active" as const }
					: policy === "manager"
						? { role: "manager" as const, availability: "drain" as const }
						: { role: "manager" as const, availability: "active" as const };

			const node = yield* docker.swarmNodes.inspect(engineNodeId);
			const currentRole = resolveSwarmNodeRole(node);
			const currentAvailability = node.Spec.Availability;
			const effectiveAvailability = currentAvailability === "pause" || currentAvailability === "drain" ? currentAvailability : "active";
			const roleChanged = currentRole !== desired.role;
			const availabilityChanged = effectiveAvailability !== desired.availability;
			let version = node.Version.Index;
			if (roleChanged || availabilityChanged) {
				yield* docker.swarmNodes.updateRoleAvailability(engineNodeId, version, desired);
				yield* Effect.logInfo(
					`Applied swarm policy ${policy}: role=${desired.role}, availability=${desired.availability}${roleChanged ? " (promoted/demoted)" : ""}${availabilityChanged ? " (drained/undrained)" : ""} — node ${engineNodeId}`,
				);
				version = (yield* docker.swarmNodes.inspect(engineNodeId)).Version.Index;
			}
			const currentLabels = node.Spec.Labels;
			const labels = withIngress(withPlatformRole(currentLabels, platformRoleForPolicy(policy)), desired.role === "manager" ? true : null);
			if (JSON.stringify(labels) !== JSON.stringify(currentLabels)) {
				yield* docker.swarmNodes.updateLabels(engineNodeId, version, labels);
			}
		}).pipe(Effect.catch((error) => Effect.logWarning(`Swarm policy application skipped: ${error.message}`)));

	const persistSnapshot = (snapshot: ClusterSnapshot): Effect.Effect<void> =>
		clusterNode.upsertFromSnapshot(snapshot).pipe(
			Effect.flatMap((row) => Effect.logInfo(`Cluster node state persisted (swarmRole=${row.swarmRole ?? "n/a"})`)),
			Effect.catch((error) => Effect.logWarning(`Cluster node state persistence skipped: ${error.message}`)),
		);

	const joinExisting = (cfg: SwarmParticipationConfig) =>
		Effect.gen(function* () {
			yield* Effect.logInfo(`Swarm participation: joining existing cluster at ${cfg.joinAddrs.join(", ") || "configured addrs"} (policy=${cfg.policy})`);
			if (cfg.joinAddrs.length === 0) {
				return yield* Effect.fail(new SwarmInvalid({ reason: "Swarm participation mode=join requires at least one control-plane address (joinAddrs)" }));
			}
			if (!cfg.joinToken) {
				return yield* Effect.fail(
					new SwarmInvalid({
						reason: "Swarm participation mode=join requires the cluster's join token — get it from the founding node (Cluster page) and set it here",
					}),
				);
			}
			yield* cluster.joinCluster({ joinToken: cfg.joinToken, remoteAddrs: cfg.joinAddrs, meshAddress: yield* meshAddress() });
			return yield* cluster.waitForActiveCluster();
		});

	const createNew = (cfg: SwarmParticipationConfig) =>
		Effect.gen(function* () {
			yield* Effect.logInfo(`Swarm participation: creating a new cluster (policy=${cfg.policy})`);
			return yield* cluster.ensureCluster(yield* initOptions(cfg));
		});

	const converge: SwarmParticipationShape["converge"] = Effect.fn("SwarmParticipation.converge")(function* () {
		const cfg = yield* effectiveConfig();
		if (defaults.swarmManaged === false) {
			yield* Effect.logInfo("Swarm convergence skipped — the deployment owns every platform service (no swarm in this profile)");
			return yield* cluster.getLocalClusterSnapshot();
		}
		const info = yield* docker.swarmCluster.info();
		if (info.LocalNodeState === "active") {
			// The active cluster is a LONE node the platform auto-founded at boot (one node, one manager),
			// which is safe to leave when the operator actually wants to join a fleet.
			const current = yield* cluster.getLocalClusterSnapshot();
			const loneAutoFounded = current.nodeCount <= 1 && current.managerCount <= 1;
			if (cfg.mode === "join" && loneAutoFounded) {
				yield* Effect.logWarning("Swarm participation switched to 'join' — leaving the lone auto-founded cluster before joining the target one");
				yield* docker.swarmCluster.leave(true);
			} else {
				yield* applyPolicy(current, yield* policyFor(cfg, current));
				yield* persistSnapshot(current);
				return current;
			}
		}
		const snapshot = cfg.mode === "join" ? yield* joinExisting(cfg) : yield* createNew(cfg);
		yield* applyPolicy(snapshot, yield* policyFor(cfg, snapshot));
		yield* persistSnapshot(snapshot);
		return snapshot;
	});

	const resolveNote = (cfg: SwarmParticipationConfig, done: boolean, active: boolean, role: string): string => {
		if (!done) return "Setup is not complete — the swarm decision is made during setup. Until then, platforms services are not scheduled on this node.";
		if (!active) return "Setup complete, but the engine is not swarm-active yet. Convergence runs on boot — or trigger it from this panel.";
		const policyLabel = cfg.policy === "auto" ? "mixed master + worker" : cfg.policy === "manager" ? "dedicated master (drained)" : "worker";
		return `Engine active — this node is a ${roleNoun(role, cfg)} (${policyLabel}).`;
	};

	const view: SwarmParticipationShape["view"] = Effect.fn("SwarmParticipation.view")(function* () {
		const cfg = yield* effectiveConfig();
		const done = yield* setupDone();
		const info = yield* docker.swarmCluster.info().pipe(Effect.catch(() => Effect.succeed(null)));
		const active = info?.LocalNodeState === "active";
		let role = "none";
		let availability = "";
		let nodeCount = 0;
		let managerCount = 0;
		let joinTokens: { worker: string; manager: string } | null = null;
		if (active) {
			const snapshot = yield* cluster.getLocalClusterSnapshot().pipe(Effect.catch(() => Effect.succeed(null)));
			role = snapshot?.localNode.swarmRole ?? "none";
			availability = snapshot?.localNode.availability ?? "active";
			nodeCount = snapshot?.nodeCount ?? 0;
			managerCount = snapshot?.managerCount ?? 0;
			joinTokens = yield* cluster.getJoinTokens().pipe(Effect.catch(() => Effect.succeed(null)));
		}
		return swarmConfigViewSchema.parse({
			participation: cfg,
			setupDone: done,
			engineState: info?.LocalNodeState ?? "unknown",
			role,
			availability,
			nodeCount,
			managerCount,
			joinTokens,
			resolveNote: resolveNote(cfg, done, active, role),
			policies: POLICY_DOCUMENTS,
		});
	});

	const applyConfig: SwarmParticipationShape["applyConfig"] = Effect.fn("SwarmParticipation.applyConfig")(function* (input) {
		const parsed = swarmParticipationInputSchema.parse(input);
		const current = yield* effectiveConfig();
		const merged = swarmParticipationSchema.parse({
			mode: parsed.mode ?? current.mode,
			policy: parsed.policy ?? current.policy,
			advertiseAddr: parsed.advertiseAddr ?? current.advertiseAddr,
			joinToken: parsed.joinToken ?? current.joinToken,
			joinAddrs: parsed.joinAddrs.length > 0 ? parsed.joinAddrs : current.joinAddrs,
		});
		const issues = swarmParticipationIssues(merged);
		if (issues.length > 0) return yield* Effect.fail(new SwarmInvalid({ reason: issues.map((issue) => issue.message).join(" ") }));

		const existing = yield* nodeConfig.find();
		yield* nodeConfig.upsert({
			...(existing ?? { nodeId: "pending", strategy: "local" as const, updatedAt: new Date().toISOString(), setupState: "not_started" as const }),
			swarmConfig: merged,
		});
		if (yield* setupDone()) {
			yield* converge().pipe(Effect.catch((error) => Effect.logWarning(`Swarm convergence after config change failed: ${error.message}`)));
		} else {
			yield* Effect.logInfo("Swarm config persisted — convergence deferred until setup completes");
		}
		return yield* view();
	});

	return { effectiveConfig, setupDone, converge, meshAddress, applyConfig, view };
}
