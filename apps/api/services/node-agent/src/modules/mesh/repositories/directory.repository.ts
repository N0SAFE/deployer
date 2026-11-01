import { Context, Effect } from "effect";

import type { ReplicaRecord } from "../rules/replica-record";

/** The records of one agent's directory, keyed by replica id. Plain state; the repository wraps it in Effects. */
export type DirectoryStore = {
  readonly upsert: (record: ReplicaRecord) => boolean;
  readonly remove: (replicaId: string) => boolean;
  readonly get: (replicaId: string, now: number) => ReplicaRecord | undefined;
  readonly snapshot: (now: number) => readonly ReplicaRecord[];
};

/**
 * `upsert` returns whether the record changed anything: a lower generation is stale and ignored, and an equal
 * generation only extends the lifetime. Gossip merges many records per round, so the answer is how a merge learns
 * that nothing new arrived.
 */
export function createDirectoryStore(): DirectoryStore {
  const records = new Map<string, ReplicaRecord>();

  return {
    upsert(record) {
      const current = records.get(record.replicaId);
      if (current && record.generation < current.generation) {
        return false;
      }
      if (record.generation === current?.generation && record.expiresAt <= current.expiresAt) {
        return false;
      }
      records.set(record.replicaId, record);
      return true;
    },
    remove: (replicaId) => records.delete(replicaId),
    get(replicaId, now) {
      const record = records.get(replicaId);
      return record && record.expiresAt > now ? record : undefined;
    },
    snapshot(now) {
      for (const [id, record] of records) {
        if (record.expiresAt <= now) {
          records.delete(id);
        }
      }
      return [...records.values()];
    },
  };
}

export type MeshDirectoryRepositoryShape = {
  readonly upsert: (record: ReplicaRecord) => Effect.Effect<boolean>;
  readonly remove: (replicaId: string) => Effect.Effect<boolean>;
  readonly get: (replicaId: string, now: number) => Effect.Effect<ReplicaRecord | undefined>;
  readonly snapshot: (now: number) => Effect.Effect<readonly ReplicaRecord[]>;
};

/** Where the agent keeps every replica of every service, in memory. State is rebuilt by registrations and gossip, so nothing is persisted. */
export class MeshDirectoryRepository extends Context.Service<
  MeshDirectoryRepository,
  MeshDirectoryRepositoryShape
>()("node-agent/MeshDirectoryRepository") {
  /**
   * The store is the one thing this repository owns; it is the constructor argument, defaulted so the module can
   * provide `MeshDirectoryRepository.live` with no wiring and a spec can hand in a store of its own:
   * `new MeshDirectoryRepository.live(store)`.
   */
  static readonly live = class MeshDirectoryRepositoryImpl implements MeshDirectoryRepositoryShape {
    private readonly store: DirectoryStore;

    constructor(store: DirectoryStore = createDirectoryStore()) {
      this.store = store;
    }

    upsert(record: ReplicaRecord) {
      return Effect.sync(() => this.store.upsert(record));
    }

    remove(replicaId: string) {
      return Effect.sync(() => this.store.remove(replicaId));
    }

    get(replicaId: string, now: number) {
      return Effect.sync(() => this.store.get(replicaId, now));
    }

    snapshot(now: number) {
      return Effect.sync(() => this.store.snapshot(now));
    }
  };
}
