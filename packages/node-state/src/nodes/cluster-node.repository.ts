import type { ClusterSnapshot } from "@deployer/contracts-entities";
import { clusterMasterHistory, clusterNode, type ClusterNodeRow } from "@deployer/nest-schema/local";
import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";

import { isMissingTable, LocalDatabaseError, NodeStateConflict } from "../database/errors";
import { LocalDatabase, type LocalDatabaseShape } from "../database/local-database";

export type ClusterNodeRepositoryShape = {
	/** This node's row in the cluster snapshot, or null before it has one. */
	readonly find: () => Effect.Effect<ClusterNodeRow | null, LocalDatabaseError>;
	/**
	 * Persists an engine-derived `ClusterSnapshot` as this node's row and returns what was stored. The
	 * snapshot is the only input: nothing is read from the environment. Join tokens are kept here so
	 * onboarding tokens survive restarts without living in `.env`.
	 */
	readonly upsertFromSnapshot: (snapshot: ClusterSnapshot) => Effect.Effect<ClusterNodeRow, LocalDatabaseError | NodeStateConflict>;
	/**
	 * Compare-and-set claim of the controlling master: succeeds only when `expectedTerm` is the
	 * persisted term, which is the single-winner guarantee for concurrent elections. On success the
	 * term is incremented and this node recorded as master.
	 */
	readonly claimMaster: (nodeId: string, expectedTerm: number, reason: string) => Effect.Effect<boolean, LocalDatabaseError>;
	/** Refreshes the master heartbeat: an active master is healthy. */
	readonly touchMasterHeartbeat: () => Effect.Effect<void, LocalDatabaseError>;
	/** Appends one master-election audit row. */
	readonly recordMasterHistory: (
		nodeId: string,
		term: number,
		reason: string,
		durationMs?: number | null,
	) => Effect.Effect<void, LocalDatabaseError>;
};

/** This node's own row in the Swarm cluster snapshot, kept in local SQLite. */
export class ClusterNodeRepository extends Context.Service<ClusterNodeRepository, ClusterNodeRepositoryShape>()(
	"node-state/ClusterNodeRepository",
) {
	static readonly layer: Layer.Layer<ClusterNodeRepository, never, LocalDatabase> = Layer.effect(
		ClusterNodeRepository,
		Effect.gen(function* () {
			return makeClusterNodeRepository(yield* LocalDatabase);
		}),
	);
}

export function makeClusterNodeRepository(database: LocalDatabaseShape): ClusterNodeRepositoryShape {
	const find: ClusterNodeRepositoryShape["find"] = () =>
		database.use("read cluster_node", (db) => db.select().from(clusterNode).limit(1).all()[0] ?? null).pipe(
			Effect.catch((error: LocalDatabaseError) =>
				isMissingTable(new Error(error.reason), "cluster_node") ? Effect.succeed(null) : Effect.fail(error),
			),
		);

	return {
		find,

		upsertFromSnapshot: (snapshot) =>
			Effect.gen(function* () {
				const now = new Date().toISOString();
				const node = snapshot.localNode;
				const values = {
					clusterId: snapshot.clusterId,
					localNodeState: snapshot.localNodeState,
					swarmRole: node.swarmRole,
					platformRole: node.platformRole,
					isMaster: node.isMaster,
					isIngress: node.isIngress,
					availability: node.availability,
					nodeCount: snapshot.nodeCount,
					managerCount: snapshot.managerCount,
					masterNodeId: snapshot.master?.nodeId ?? null,
					masterTerm: snapshot.master?.term ?? 0,
					joinTokenWorker: snapshot.joinTokens?.worker ?? null,
					joinTokenManager: snapshot.joinTokens?.manager ?? null,
					lastHeartbeatAt: node.lastHeartbeatAt ?? now,
					updatedAt: now,
				};
				yield* database.use("write cluster_node", (db) => { db.insert(clusterNode).values({ id: 1, ...values }).onConflictDoUpdate({ target: clusterNode.id, set: values }).run(); },
				);
				const row = yield* find();
				if (row === null) return yield* Effect.fail(new NodeStateConflict({ reason: "ClusterNode upsert succeeded but row was not found" }));
				return row;
			}),

		claimMaster: (nodeId, expectedTerm) =>
			Effect.gen(function* () {
				const row = yield* find();
				if (row?.masterTerm !== expectedTerm) return false;
				const now = new Date().toISOString();
				yield* database.use("claim master", (db) => { db
						.update(clusterNode)
						.set({ masterNodeId: nodeId, masterTerm: expectedTerm + 1, isMaster: true, lastHeartbeatAt: now, updatedAt: now })
						.where(eq(clusterNode.id, 1))
						.run(); },
				);
				return true;
			}),

		touchMasterHeartbeat: () =>
			database
				.use("touch master heartbeat", (db) => {
					const now = new Date().toISOString();
					db.update(clusterNode).set({ lastHeartbeatAt: now, updatedAt: now }).where(eq(clusterNode.id, 1)).run();
				}),

		recordMasterHistory: (nodeId, term, reason, durationMs = null) =>
			database.use("record master history", (db) => {
				db.insert(clusterMasterHistory).values({ nodeId, term, electedAt: new Date().toISOString(), reason, durationMs }).run();
			}),
	};
}
