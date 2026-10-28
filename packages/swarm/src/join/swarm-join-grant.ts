import type { MeshSwarmJoinGrant, SwarmNodePolicy } from "@deployer/contracts-entities";
import { Context, Effect, Layer } from "effect";

import { SwarmCluster, type SwarmClusterShape } from "../cluster/swarm-cluster";
import {
	SwarmJoinConfigService,
	SwarmParticipationDefaultsService,
	type SwarmJoinConfig,
	type SwarmParticipationDefaults,
} from "../config";
import { decideRole, quorumTarget } from "./join-decision";

export type SwarmJoinGrantShape = {
	/**
	 * The fleet's answer to "may this joining node become a manager?": the join tokens and the role it is
	 * granted, or null when there is no converged swarm to join. Never fails: a fleet that cannot produce
	 * a grant leaves the joiner converging later (its supervisors degrade with a clear reason) instead of
	 * failing its whole setup. The decision order: no converged swarm, no grant; "worker" asked, worker
	 * granted; "manager" or "auto" is a candidate admitted to quorum only while the fleet benefits.
	 */
	readonly buildGrant: (requested: SwarmNodePolicy | undefined) => Effect.Effect<MeshSwarmJoinGrant | null>;
	readonly decideRole: typeof decideRole;
};

/** The FLEET's role decision for a joining node: a node cannot promote itself into the Raft quorum. */
export class SwarmJoinGrant extends Context.Service<SwarmJoinGrant, SwarmJoinGrantShape>()("swarm/SwarmJoinGrant") {
	static readonly layer: Layer.Layer<SwarmJoinGrant, never, SwarmCluster | SwarmJoinConfigService | SwarmParticipationDefaultsService> =
		Layer.effect(
			SwarmJoinGrant,
			Effect.gen(function* () {
				return makeSwarmJoinGrant({
					cluster: yield* SwarmCluster,
					config: yield* SwarmJoinConfigService,
					participation: yield* SwarmParticipationDefaultsService,
				});
			}),
		);
}

export function makeSwarmJoinGrant(deps: {
	readonly cluster: SwarmClusterShape;
	/** The quorum cap, supplied as data: which variables name it is an app convention. */
	readonly config: SwarmJoinConfig;
	readonly participation: SwarmParticipationDefaults;
}): SwarmJoinGrantShape {
	const { cluster, config, participation } = deps;

	const reachable = (addrs: string[]) => addrs.filter((addr) => !addr.startsWith("127.") && !addr.startsWith("0.0.0.0"));

	/**
	 * Where a joiner reaches the control plane: the addresses its MANAGERS advertise, read from the engine,
	 * the only set guaranteed to be where it listens. A lone cluster founded before the node had a mesh
	 * address advertises loopback, which no joiner can dial, so it is re-anchored onto the mesh address first.
	 */
	const resolveControlPlaneAddrs = Effect.gen(function* () {
		const first = reachable(yield* cluster.managerAddresses());
		if (first.length > 0) return first;
		const mesh = yield* (participation.meshAddress ?? Effect.succeed(null)).pipe(Effect.catch(() => Effect.succeed(null)));
		if (mesh === null) return [];
		yield* cluster.reanchorLoneCluster(mesh);
		return reachable(yield* cluster.managerAddresses());
	});

	const buildGrant: SwarmJoinGrantShape["buildGrant"] = Effect.fn("SwarmJoinGrant.buildGrant")(function* (requested) {
		return yield* Effect.gen(function* () {
			const snapshot = yield* cluster.getLocalClusterSnapshot();
			if (snapshot.localNodeState !== "active") {
				yield* Effect.logInfo(`No swarm join grant — this node's engine is ${snapshot.localNodeState} (not an active cluster)`);
				return null;
			}
			const tokens = yield* cluster.getJoinTokens();
			if (tokens === null) {
				yield* Effect.logWarning("No swarm join grant — the cluster reports no join tokens");
				return null;
			}
			const { target, warning } = quorumTarget(config.quorumMax);
			if (warning !== null) yield* Effect.logWarning(warning);
			const { role, reason } = decideRole({ requested, managerCount: snapshot.managerCount, target });
			const controlPlaneAddrs = yield* resolveControlPlaneAddrs;
			if (controlPlaneAddrs.length === 0) {
				yield* Effect.logWarning("No swarm join grant — no control-plane address could be resolved for the joiner");
				return null;
			}
			yield* Effect.logInfo(
				`Swarm join grant: role=${role} (requested=${requested ?? "auto"}, managers=${String(snapshot.managerCount)}/${String(target)}) — ${reason}`,
			);
			return {
				workerToken: tokens.worker,
				managerToken: role === "manager" ? tokens.manager : null,
				controlPlaneAddrs,
				role,
				reason,
			} satisfies MeshSwarmJoinGrant;
		}).pipe(
			Effect.catch((error) => Effect.logWarning(`Swarm join grant unavailable: ${error.message}`).pipe(Effect.as(null))),
		);
	});

	return { buildGrant, decideRole };
}
