import { Context, Effect } from "effect";

import { LeaseSigner } from "../../platform/services/lease-signer.service";
import { MeshClock } from "../../platform/services/mesh-clock.service";
import { MeshNoReplica } from "../mesh.errors";

import { ReplicaStore, type ReplicaRecord } from "./replica-store.service";

/** How long a registration survives without a refresh. */
const LEASE_TTL_MS = 30_000;

export type ReplicaRegistration = {
	readonly service: string;
	readonly replicaId: string;
	readonly address: string;
};

export type Resolution = {
	readonly replica: ReplicaRecord;
	readonly reason: "local" | "remote";
};

export type MeshDirectoryShape = {
	readonly register: (
		registration: ReplicaRegistration,
	) => Effect.Effect<ReplicaRecord, never, ReplicaStore | MeshClock | LeaseSigner>;
	readonly unregister: (replicaId: string) => Effect.Effect<boolean, never, ReplicaStore>;
	readonly resolve: (
		query: { readonly service: string },
	) => Effect.Effect<Resolution, MeshNoReplica, ReplicaStore | MeshClock>;
	readonly snapshot: () => Effect.Effect<readonly ReplicaRecord[], never, ReplicaStore | MeshClock>;
};

/**
 * The agent's view of every replica of every service.
 *
 * A registration is stamped here, not trusted: the expiry comes from the agent's clock and the grant from the platform
 * signer, so a replica can neither claim another node nor outlive its own heartbeat.
 */
export class MeshDirectory extends Context.Service<MeshDirectory, MeshDirectoryShape>()("demo/MeshDirectory") {
	static readonly live: MeshDirectoryShape = {
		register: Effect.fn("MeshDirectory.register")(function* (registration: ReplicaRegistration) {
			const store = yield* ReplicaStore;
			const clock = yield* MeshClock;
			const signer = yield* LeaseSigner;

			const expiresAt = clock.now() + LEASE_TTL_MS;
			const record: ReplicaRecord = {
				...registration,
				expiresAt,
				leaseToken: signer.sign(registration.replicaId, expiresAt),
			};

			yield* store.upsert(record);
			return record;
		}),

		unregister: Effect.fn("MeshDirectory.unregister")(function* (replicaId: string) {
			const store = yield* ReplicaStore;
			return yield* store.remove(replicaId);
		}),

		resolve: Effect.fn("MeshDirectory.resolve")(function* (query: { readonly service: string }) {
			const store = yield* ReplicaStore;
			const clock = yield* MeshClock;
			const now = clock.now();

			const replica = (yield* store.all()).find(
				(candidate) => candidate.service === query.service && candidate.expiresAt > now,
			);

			if (replica === undefined) {
				return yield* Effect.fail(new MeshNoReplica({ service: query.service }));
			}

			return { replica, reason: "local" as const };
		}),

		snapshot: Effect.fn("MeshDirectory.snapshot")(function* () {
			const store = yield* ReplicaStore;
			const clock = yield* MeshClock;
			const now = clock.now();

			return (yield* store.all()).filter((record) => record.expiresAt > now);
		}),
	};
}
