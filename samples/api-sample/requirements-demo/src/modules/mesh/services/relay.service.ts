import { Context, Effect } from "effect";

import { LeaseSigner } from "../../platform/services/lease-signer.service";

import { ReplicaStore } from "./replica-store.service";

export type MeshRelayShape = {
	readonly forward: (replicaId: string) => Effect.Effect<{ readonly accepted: boolean }, never, ReplicaStore | LeaseSigner>;
};

/** Relays a call to a replica, using the replica's current grant. */
export class MeshRelay extends Context.Service<MeshRelay, MeshRelayShape>()("demo/MeshRelay") {
	static readonly live: MeshRelayShape = {
		forward: Effect.fn("MeshRelay.forward")(function* (replicaId: string) {
			const store = yield* ReplicaStore;
			const signer = yield* LeaseSigner;

			const replica = yield* store.get(replicaId);
			if (replica === undefined) {
				return { accepted: false };
			}

			signer.sign(replica.replicaId, replica.expiresAt);
			return { accepted: true };
		}),
	};
}
