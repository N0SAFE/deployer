import { Context, Effect } from "effect";

import { nodeMeshConfig } from "@deployer/nest-schema/local";
import type { LocalDatabaseError, LocalDatabaseShape } from "@deployer/node-state";

export type NodeMeshConfigRow = typeof nodeMeshConfig.$inferSelect;

const MISSING_TABLE = "no such table: node_mesh_config";

export type NodeMeshConfigRepositoryShape = {
	/** The row, or null when there is none or the local table has not been migrated yet. */
	readonly find: () => Effect.Effect<NodeMeshConfigRow | null, LocalDatabaseError>;
	/**
	 * Returns the row after insert, OR `null` if the local `node_mesh_config` table hasn't been migrated yet. Callers must
	 * handle the `null` case by using in-memory defaults — see `SystemMeshConfigService`'s boot resolution for the fallback.
	 */
	readonly upsert: (data: Omit<typeof nodeMeshConfig.$inferInsert, "id">) => Effect.Effect<NodeMeshConfigRow | null, LocalDatabaseError>;
};

const isMissingTable = (error: LocalDatabaseError) => error.reason.includes(MISSING_TABLE);

export function makeNodeMeshConfigRepository(localDb: LocalDatabaseShape): NodeMeshConfigRepositoryShape {
	const find: NodeMeshConfigRepositoryShape["find"] = () =>
		localDb
			.use("node_mesh_config.find", (db) => db.select().from(nodeMeshConfig).limit(1).all())
			.pipe(
				Effect.map((rows) => rows[0] ?? null),
				Effect.catchIf(isMissingTable, () => Effect.succeed(null)),
			);

	return {
		find,
		upsert: (data) =>
			Effect.gen(function* () {
				const now = new Date().toISOString();
				yield* localDb.use("node_mesh_config.upsert", (db) => {
					db
						.insert(nodeMeshConfig)
						.values({ id: 1, ...data, updatedAt: now })
						.onConflictDoUpdate({ target: nodeMeshConfig.id, set: { ...data, updatedAt: now } })
						.run();
				});
				return yield* find();
			}).pipe(
				Effect.catchIf(isMissingTable, () =>
					Effect.logWarning(
						"node_mesh_config table missing on local SQLite — local migrations probably did not run. " +
							"Returning null so the caller can fall back to in-memory defaults.",
					).pipe(Effect.as(null)),
				),
			),
	};
}

export class NodeMeshConfigRepository extends Context.Service<NodeMeshConfigRepository, NodeMeshConfigRepositoryShape>()(
	"shared/NodeMeshConfigRepository",
) {}
