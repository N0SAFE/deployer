import { Context, Effect } from "effect";

import { createDirectoryStore } from "./directory-store";
import { resolveReplica } from "./resolve-replica";

import type { ReplicaRecord, Resolution, ResolveQuery } from "./replica-record";

export type MeshDirectoryShape = {
  /** A replica registers itself or refreshes its lease; a gossip merge calls it once per record. Returns whether anything changed. */
  readonly register: (record: ReplicaRecord) => Effect.Effect<boolean>;
  readonly unregister: (replicaId: string) => Effect.Effect<void>;
  readonly get: (replicaId: string, now: number) => Effect.Effect<ReplicaRecord | undefined>;
  readonly snapshot: (now: number) => Effect.Effect<readonly ReplicaRecord[]>;
  readonly resolve: (query: ResolveQuery) => Effect.Effect<Resolution | undefined>;
};

/** Directory over a given store. Separate from `live` so a test gets a store of its own. */
export function directoryOver(store: ReturnType<typeof createDirectoryStore>): MeshDirectoryShape {
  return {
    register: (record) => Effect.sync(() => store.upsert(record)),
    unregister: (replicaId) => Effect.sync(() => { store.remove(replicaId); }),
    get: (replicaId, now) => Effect.sync(() => store.get(replicaId, now)),
    snapshot: (now) => Effect.sync(() => store.snapshot(now)),
    resolve: (query) => Effect.sync(() => resolveReplica(store.snapshot(query.now), query)),
  };
}

/** The agent's view of every replica of every service, kept current by registrations and roster gossip. */
export class MeshDirectory extends Context.Service<MeshDirectory, MeshDirectoryShape>()("mesh-agent/MeshDirectory") {
  static readonly live: MeshDirectoryShape = directoryOver(createDirectoryStore());
}
