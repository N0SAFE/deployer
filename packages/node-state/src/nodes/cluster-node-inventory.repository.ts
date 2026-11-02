import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import type { DockerodeNodeSummary } from "@deployer/contracts-entities";
import { clusterNodes, type ClusterNodesRow } from "@deployer/nest-schema/local";

import { isMissingTable, LocalDatabaseError } from "../database/errors";
import { LocalDatabase, type LocalDatabaseShape } from "../database/local-database";

import { toEngineNodeRow, type EngineNodeRow } from "./engine-node-row";

export type ClusterNodeInventoryRepositoryShape = {
	/** The persisted inventory; empty before the table exists. */
	readonly list: () => Effect.Effect<ClusterNodesRow[], LocalDatabaseError>;
	readonly findByNodeId: (nodeId: string) => Effect.Effect<ClusterNodesRow | null, LocalDatabaseError>;
	/** Upserts one node from engine truth and returns the stored row. */
	readonly upsertFromEngine: (node: EngineNodeRow) => Effect.Effect<ClusterNodesRow, LocalDatabaseError>;
	/** Marks every node not in `nodeIdsSeen` as `down`; the number changed. */
	readonly markMissingNodeDown: (nodeIdsSeen: string[]) => Effect.Effect<number, LocalDatabaseError>;
	/** Bulk upsert from engine node summaries; the number written. */
	readonly upsertAllFromEngine: (nodes: DockerodeNodeSummary[]) => Effect.Effect<number, LocalDatabaseError>;
};

/**
 * The local cache of `docker node ls`: one row per Swarm node, upserted from engine output. Cross-node
 * reads for the UI and ops use this stable snapshot; only the node inventory sweep polls the engine.
 */
export class ClusterNodeInventoryRepository extends Context.Service<
	ClusterNodeInventoryRepository,
	ClusterNodeInventoryRepositoryShape
>()("node-state/ClusterNodeInventoryRepository") {
	static readonly layer: Layer.Layer<ClusterNodeInventoryRepository, never, LocalDatabase> = Layer.effect(
		ClusterNodeInventoryRepository,
		Effect.gen(function* () {
			return makeClusterNodeInventoryRepository(yield* LocalDatabase);
		}),
	);
}

export function makeClusterNodeInventoryRepository(database: LocalDatabaseShape): ClusterNodeInventoryRepositoryShape {
	const list: ClusterNodeInventoryRepositoryShape["list"] = () =>
		database.use("read cluster_nodes", (db) => db.select().from(clusterNodes).all()).pipe(
			Effect.catch((error: LocalDatabaseError) =>
				isMissingTable(new Error(error.reason), "cluster_nodes") ? Effect.succeed([]) : Effect.fail(error),
			),
		);

	const findByNodeId: ClusterNodeInventoryRepositoryShape["findByNodeId"] = (nodeId) =>
		list().pipe(Effect.map((rows) => rows.find((row) => row.nodeId === nodeId) ?? null));

	const upsertFromEngine: ClusterNodeInventoryRepositoryShape["upsertFromEngine"] = (node) =>
		Effect.gen(function* () {
			const now = new Date().toISOString();
			const values = {
				hostname: node.hostname,
				swarmRole: node.swarmRole,
				platformRole: node.platformRole,
				isLeader: node.isLeader,
				isIngress: node.isIngress,
				availability: node.availability,
				nanoCpus: node.nanoCpus,
				memoryBytes: node.memoryBytes,
				labels: node.labels,
				state: node.state === "ready" ? ("active" as const) : ("down" as const),
				lastSeenAt: now,
				updatedAt: now,
			};
			yield* database.use("write cluster_nodes", (db) => { db
					.insert(clusterNodes)
					.values({ nodeId: node.nodeId, ...values })
					.onConflictDoUpdate({ target: clusterNodes.nodeId, set: values })
					.run(); },
			);
			const stored = yield* findByNodeId(node.nodeId);
			return yield* stored === null
				? Effect.fail(new LocalDatabaseError({ operation: "write cluster_nodes", reason: "upsert succeeded but row was not found" }))
				: Effect.succeed(stored);
		});

	return {
		list,
		findByNodeId,
		upsertFromEngine,
		markMissingNodeDown: (nodeIdsSeen) =>
			Effect.gen(function* () {
				const now = new Date().toISOString();
				const seen = new Set(nodeIdsSeen);
				let changed = 0;
				for (const row of yield* list()) {
					if (seen.has(row.nodeId)) continue;
					yield* database.use("mark node down", (db) => {
						db.update(clusterNodes).set({ state: "down", updatedAt: now }).where(eq(clusterNodes.nodeId, row.nodeId)).run();
					});
					changed += 1;
				}
				return changed;
			}),
		upsertAllFromEngine: (nodes) =>
			Effect.gen(function* () {
				for (const node of nodes) yield* upsertFromEngine(toEngineNodeRow(node));
				return nodes.length;
			}),
	};
}
