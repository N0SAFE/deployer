import { nodeConfig } from "@deployer/nest-schema/local";
import { Context, Effect, Layer } from "effect";

import { isMissingTable, LocalDatabaseError, NodeStateConflict } from "../database/errors";
import { LocalDatabase, type LocalDatabaseShape } from "../database/local-database";

export type NodeConfigRow = typeof nodeConfig.$inferSelect;

export type NodeConfigRepositoryShape = {
	/** This node's own config, or null before it has one (including before the table exists). */
	readonly find: () => Effect.Effect<NodeConfigRow | null, LocalDatabaseError>;
	/** Creates or replaces the node's config row and returns it. */
	readonly upsert: (data: Omit<typeof nodeConfig.$inferInsert, "id">) => Effect.Effect<NodeConfigRow, LocalDatabaseError | NodeStateConflict>;
	/** The mesh shared secret, or null when there is no row or the column is empty. */
	readonly getMeshSharedSecret: () => Effect.Effect<string | null, LocalDatabaseError>;
	/** Merges `peerUrls` into the stored peer snapshot, deduplicated; null when there is no row yet. */
	readonly updateMeshPeers: (peerUrls: string[]) => Effect.Effect<NodeConfigRow | null, LocalDatabaseError | NodeStateConflict>;
};

/** The node's own config: the cluster decision the setup app records before the global Postgres exists. */
export class NodeConfigRepository extends Context.Service<NodeConfigRepository, NodeConfigRepositoryShape>()(
	"node-state/NodeConfigRepository",
) {
	static readonly layer: Layer.Layer<NodeConfigRepository, never, LocalDatabase> = Layer.effect(
		NodeConfigRepository,
		Effect.gen(function* () {
			return makeNodeConfigRepository(yield* LocalDatabase);
		}),
	);
}

export function makeNodeConfigRepository(database: LocalDatabaseShape): NodeConfigRepositoryShape {
	const find: NodeConfigRepositoryShape["find"] = () =>
		database.use("read node_config", (db) => db.select().from(nodeConfig).limit(1).all()[0] ?? null).pipe(
			Effect.catch((error: LocalDatabaseError) =>
				isMissingTable(new Error(error.reason), "node_config") ? Effect.succeed(null) : Effect.fail(error),
			),
		);

	const upsert: NodeConfigRepositoryShape["upsert"] = (data) =>
		Effect.gen(function* () {
			const now = new Date().toISOString();
			yield* database.use("write node_config", (db) => { db
					.insert(nodeConfig)
					.values({ id: 1, ...data, updatedAt: now })
					.onConflictDoUpdate({ target: nodeConfig.id, set: { ...data, updatedAt: now } })
					.run(); },
			);
			const row = yield* find();
			if (row === null) return yield* Effect.fail(new NodeStateConflict({ reason: "NodeConfig upsert succeeded but row was not found" }));
			return row;
		});

	return {
		find,
		upsert,
		getMeshSharedSecret: () =>
			find().pipe(
				Effect.map((row) => {
					if (row === null) return null;
					const record = row as Record<string, unknown>;
					return (record.meshSharedSecret ?? record.mesh_shared_secret ?? null) as string | null;
				}),
			),
		updateMeshPeers: (peerUrls) =>
			Effect.gen(function* () {
				const existing = yield* find();
				if (existing === null) return null;
				const merged = [...new Set([...(existing.meshUrlsSnapshot ?? []), ...peerUrls])];
				return yield* upsert({ ...existing, meshUrlsSnapshot: merged, updatedAt: new Date().toISOString() });
			}),
	};
}
