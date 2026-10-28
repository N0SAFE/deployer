import {
	clusterSnapshotSchema,
	type ClusterSnapshot,
	type DockerodeNodeSummary,
	type DockerodeServiceSummary,
	type SwarmInitOptions,
} from "@deployer/contracts-entities";
import { DockerEngine, resolveSwarmNodeRole, type DockerEngineShape, type DockerError } from "@deployer/docker";
import { ingressFromLabels, platformRoleFromLabels } from "@deployer/node-state";
import { Context, Effect, Layer } from "effect";

import { SwarmTimeout, SwarmUnavailable } from "../errors";

const JOIN_WAIT_ATTEMPTS = 10;
const JOIN_WAIT_INTERVAL_MS = 1_000;

export type SwarmClusterShape = {
	/** Succeeds when the local engine is an active swarm member: the readiness gate for runners. */
	readonly assertClusterReady: () => Effect.Effect<void, SwarmUnavailable | DockerError>;
	/**
	 * Makes the local engine a member of a cluster, idempotently: nothing to do when active, a wait
	 * when a join is pending, `swarm init` when inactive.
	 */
	readonly ensureCluster: (
		options: SwarmInitOptions,
	) => Effect.Effect<ClusterSnapshot, SwarmUnavailable | SwarmTimeout | DockerError>;
	/** Joins an existing cluster with a token issued by its controlling node. */
	readonly joinCluster: (options: {
		readonly joinToken: string;
		readonly remoteAddrs: string[];
		/** This node's mesh address: listen, advertise and data path all bind it. */
		readonly meshAddress?: string | null;
	}) => Effect.Effect<ClusterSnapshot, DockerError>;
	/**
	 * Re-founds a LONE single-node cluster on a new address, keeping its state. A cluster founded
	 * before the node had a mesh address advertises loopback, which no joiner can dial; a forced new
	 * cluster with a new advertise address is the engine's own way to move a manager. Refused for
	 * anything but a one-node cluster, where there is no peer to lose.
	 */
	readonly reanchorLoneCluster: (meshAddress: string) => Effect.Effect<void, SwarmUnavailable | SwarmTimeout | DockerError>;
	/** The addresses the managers advertise (`host:2377`), from the engine. */
	readonly managerAddresses: () => Effect.Effect<string[], DockerError>;
	/**
	 * The platform's typed view of the local swarm, derived entirely from engine probes. When the engine
	 * is not in an active cluster only the cheap `info` probe runs (inspect and node list answer 503 on
	 * non-manager nodes); the result carries `localNodeState` for callers to gate on.
	 */
	readonly getLocalClusterSnapshot: () => Effect.Effect<ClusterSnapshot, DockerError>;
	/** Join tokens for onboarding more nodes; null when the engine is not in an active cluster. */
	readonly getJoinTokens: () => Effect.Effect<{ worker: string; manager: string } | null, DockerError>;
	/** The services labelled with `deployer.deployment_id` = `deploymentId`. */
	readonly listSwarmServicesForDeployment: (deploymentId: string) => Effect.Effect<DockerodeServiceSummary[], DockerError>;
	readonly listSwarmNodes: () => Effect.Effect<DockerodeNodeSummary[], DockerError>;
	readonly inspectSwarmNode: (nodeId: string) => Effect.Effect<DockerodeNodeSummary, DockerError>;
	readonly updateSwarmNodeLabels: (nodeId: string, version: number, labels: Record<string, string>) => Effect.Effect<void, DockerError>;
	/**
	 * Waits until the engine reports an active membership. A join is asynchronous: the engine
	 * acknowledges it at once but the membership is usable only when the Raft join settles, so the wait
	 * lives here once for every caller that joins.
	 */
	readonly waitForActiveCluster: () => Effect.Effect<ClusterSnapshot, SwarmTimeout | DockerError>;
};

/** Single-node and multi-node cluster bootstrap and state, over the Docker engine. */
export class SwarmCluster extends Context.Service<SwarmCluster, SwarmClusterShape>()("swarm/SwarmCluster") {
	static readonly layer: Layer.Layer<SwarmCluster, never, DockerEngine> = Layer.effect(
		SwarmCluster,
		Effect.gen(function* () {
			return makeSwarmCluster(yield* DockerEngine);
		}),
	);
}

const inactiveSnapshot = (info: { LocalNodeState: string; ControlAvailable: boolean; NodeID: string }) =>
	clusterSnapshotSchema.parse({
		clusterId: null,
		clusterName: null,
		localNodeState: info.LocalNodeState,
		controlAvailable: info.ControlAvailable,
		nodeCount: 0,
		managerCount: 0,
		localNode: {
			nodeId: info.NodeID.length > 0 ? info.NodeID : "unknown",
			hostname: "",
			swarmRole: "none",
			platformRole: "both",
			isMaster: false,
			isIngress: false,
			availability: "active",
			capacity: { nanoCpus: null, memoryBytes: null },
			labels: {},
			lastHeartbeatAt: null,
		},
		master: null,
		membership: { nodeId: info.NodeID.length > 0 ? info.NodeID : "unknown", state: "down", joinedAt: new Date().toISOString() },
		joinTokens: null,
	});

/**
 * THIS node's view within the engine node list. Roles reuse the shared `resolveSwarmNodeRole` (never
 * guess a manager as a worker); the platform role and ingress flag come from the node's own labels,
 * the durable record of that configuration.
 */
const buildLocalNode = (nodeId: string, nodes: DockerodeNodeSummary[]): ClusterSnapshot["localNode"] => {
	const self = nodes.find((node) => node.ID === nodeId) ?? null;
	const labels = self?.Spec.Labels ?? {};
	return {
		nodeId: nodeId.length > 0 ? nodeId : "unknown",
		hostname: self?.Description.Hostname ?? "",
		swarmRole: self === null ? "worker" : resolveSwarmNodeRole(self),
		platformRole: platformRoleFromLabels(labels),
		isMaster: self?.ManagerStatus?.Leader === true,
		isIngress: ingressFromLabels(labels),
		availability: self?.Spec.Availability === "pause" || self?.Spec.Availability === "drain" ? self.Spec.Availability : "active",
		capacity: { nanoCpus: self?.Description.Resources?.NanoCPUs ?? null, memoryBytes: self?.Description.Resources?.MemoryBytes ?? null },
		labels,
		lastHeartbeatAt: new Date().toISOString(),
	};
};

export function makeSwarmCluster(docker: DockerEngineShape): SwarmClusterShape {
	const unavailable = (state: string) => new SwarmUnavailable({ reason: `docker swarm on this node (state=${state})` });

	const getLocalClusterSnapshot: SwarmClusterShape["getLocalClusterSnapshot"] = Effect.fn("SwarmCluster.getLocalClusterSnapshot")(
		function* () {
			const info = yield* docker.swarmCluster.info();
			if (info.LocalNodeState !== "active") return inactiveSnapshot(info);

			const [inspect, nodes] = yield* Effect.all([docker.swarmCluster.inspect(), docker.swarmNodes.list()], { concurrency: "unbounded" });
			const localNode = buildLocalNode(info.NodeID, nodes);
			const leader = nodes.find((node) => node.ManagerStatus?.Leader === true) ?? null;
			const now = new Date().toISOString();
			return clusterSnapshotSchema.parse({
				clusterId: inspect.ID.length > 0 ? inspect.ID : null,
				clusterName: inspect.Spec?.Name ?? null,
				localNodeState: info.LocalNodeState,
				controlAvailable: info.ControlAvailable,
				nodeCount: info.Nodes,
				managerCount: info.Managers,
				localNode,
				master: {
					nodeId: leader?.ID ?? localNode.nodeId,
					term: 1,
					electedAt: now,
					heartbeatAt: now,
					reason: leader ? "raft_leader" : "single_node",
				},
				membership: { nodeId: localNode.nodeId, state: "active", joinedAt: now },
				joinTokens: inspect.JoinTokens ? { worker: inspect.JoinTokens.Worker, manager: inspect.JoinTokens.Manager } : null,
			});
		},
	);

	const waitForActiveCluster: SwarmClusterShape["waitForActiveCluster"] = Effect.fn("SwarmCluster.waitForActiveCluster")(function* () {
		for (let attempt = 1; attempt <= JOIN_WAIT_ATTEMPTS; attempt++) {
			const info = yield* docker.swarmCluster.info();
			if (info.LocalNodeState === "active") return yield* getLocalClusterSnapshot();
			if (attempt < JOIN_WAIT_ATTEMPTS) yield* Effect.sleep(JOIN_WAIT_INTERVAL_MS);
		}
		return yield* Effect.fail(
			new SwarmTimeout({ waitingFor: "the swarm cluster to become active", afterMs: JOIN_WAIT_ATTEMPTS * JOIN_WAIT_INTERVAL_MS }),
		);
	});

	const waitForPendingJoin = (options: SwarmInitOptions) =>
		Effect.gen(function* () {
			for (let attempt = 1; attempt <= JOIN_WAIT_ATTEMPTS; attempt++) {
				yield* Effect.logInfo(`Waiting for Swarm cluster state to settle (attempt ${String(attempt)})`);
				if (attempt > 1) yield* Effect.sleep(JOIN_WAIT_INTERVAL_MS);
				const info = yield* docker.swarmCluster.info();
				if (info.LocalNodeState === "active") return yield* getLocalClusterSnapshot();
				if (info.LocalNodeState === "inactive") {
					yield* docker.swarmCluster.init(options);
					return yield* getLocalClusterSnapshot();
				}
			}
			return yield* Effect.fail(
				new SwarmTimeout({ waitingFor: "Swarm cluster state to settle", afterMs: JOIN_WAIT_ATTEMPTS * JOIN_WAIT_INTERVAL_MS }),
			);
		});

	return {
		assertClusterReady: Effect.fn("SwarmCluster.assertClusterReady")(function* () {
			const info = yield* docker.swarmCluster.info();
			if (info.LocalNodeState !== "active") return yield* Effect.fail(unavailable(info.LocalNodeState));
		}),

		ensureCluster: Effect.fn("SwarmCluster.ensureCluster")(function* (options) {
			const info = yield* docker.swarmCluster.info();
			if (info.LocalNodeState === "active") return yield* getLocalClusterSnapshot();
			if (info.LocalNodeState === "pending") return yield* waitForPendingJoin(options);
			if (info.LocalNodeState === "inactive" || info.LocalNodeState === "locked") {
				yield* docker.swarmCluster.init(options);
				yield* Effect.logInfo(`Initialized Swarm cluster (advertise=${options.AdvertiseAddr ?? "default"})`);
				return yield* getLocalClusterSnapshot();
			}
			return yield* Effect.fail(unavailable(info.LocalNodeState));
		}),

		joinCluster: Effect.fn("SwarmCluster.joinCluster")(function* (options) {
			const mesh = options.meshAddress ?? null;
			yield* docker.swarmCluster.join({
				RemoteAddrs: options.remoteAddrs,
				JoinToken: options.joinToken,
				...(mesh === null ? {} : { ListenAddr: `${mesh}:2377`, AdvertiseAddr: `${mesh}:2377`, DataPathAddr: mesh }),
			});
			return yield* getLocalClusterSnapshot();
		}),

		reanchorLoneCluster: Effect.fn("SwarmCluster.reanchorLoneCluster")(function* (meshAddress) {
			const snapshot = yield* getLocalClusterSnapshot();
			if (snapshot.nodeCount > 1 || snapshot.managerCount > 1) {
				return yield* Effect.fail(
					new SwarmUnavailable({
						reason: `re-anchoring a ${String(snapshot.nodeCount)}-node cluster (only a lone node may be re-founded)`,
					}),
				);
			}
			yield* docker.swarmCluster.init({
				ForceNewCluster: true,
				ListenAddr: `${meshAddress}:2377`,
				AdvertiseAddr: `${meshAddress}:2377`,
				DataPathAddr: meshAddress,
			});
			yield* waitForActiveCluster();
			yield* Effect.logInfo(`Re-anchored the lone cluster on its mesh address ${meshAddress}`);
		}),

		managerAddresses: () =>
			docker.swarmNodes.list().pipe(Effect.map((nodes) => nodes.map((node) => node.ManagerStatus?.Addr ?? "").filter((addr) => addr !== ""))),

		getLocalClusterSnapshot,

		getJoinTokens: Effect.fn("SwarmCluster.getJoinTokens")(function* () {
			const info = yield* docker.swarmCluster.info();
			if (info.LocalNodeState !== "active") return null;
			const inspect = yield* docker.swarmCluster.inspect();
			return inspect.JoinTokens ? { worker: inspect.JoinTokens.Worker, manager: inspect.JoinTokens.Manager } : null;
		}),

		listSwarmServicesForDeployment: (deploymentId) =>
			docker.swarmServices.list().pipe(Effect.map((services) => services.filter((service) => service.Spec.Labels["deployer.deployment_id"] === deploymentId))),

		listSwarmNodes: () => docker.swarmNodes.list(),
		inspectSwarmNode: (nodeId) => docker.swarmNodes.inspect(nodeId),
		updateSwarmNodeLabels: (nodeId, version, labels) => docker.swarmNodes.updateLabels(nodeId, version, labels),
		waitForActiveCluster,
	};
}
