import { Context, Effect } from "effect";

/** A replica as the agent stores it: stamped by the agent, never trusted from the wire. */
export type ReplicaRecord = {
	readonly service: string;
	readonly replicaId: string;
	readonly address: string;
	readonly leaseToken: string;
	readonly expiresAt: number;
};

export type ReplicaStoreShape = {
	readonly upsert: (record: ReplicaRecord) => Effect.Effect<void>;
	readonly remove: (replicaId: string) => Effect.Effect<boolean>;
	readonly get: (replicaId: string) => Effect.Effect<ReplicaRecord | undefined>;
	readonly all: () => Effect.Effect<readonly ReplicaRecord[]>;
};

/** The agent's table of announced replicas. State lives next to `live`, so every call sees the same table. */
export class ReplicaStore extends Context.Service<ReplicaStore, ReplicaStoreShape>()("demo/ReplicaStore") {
	static readonly live: ReplicaStoreShape = (() => {
		const records = new Map<string, ReplicaRecord>();

		return {
			upsert: Effect.fn("ReplicaStore.upsert")(function* (record: ReplicaRecord) {
				records.set(record.replicaId, record);
			}),
			remove: Effect.fn("ReplicaStore.remove")(function* (replicaId: string) {
				return records.delete(replicaId);
			}),
			get: Effect.fn("ReplicaStore.get")(function* (replicaId: string) {
				return records.get(replicaId);
			}),
			all: Effect.fn("ReplicaStore.all")(function* () {
				return [...records.values()];
			}),
		};
	})();
}
