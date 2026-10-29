import type { ReplicaRecord } from "./replica-record";

/** The records of one agent's directory, keyed by replica id. Plain state; the service wraps it in Effects. */
export type DirectoryStore = {
  readonly upsert: (record: ReplicaRecord) => boolean;
  readonly remove: (replicaId: string) => void;
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
    remove(replicaId) {
      records.delete(replicaId);
    },
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
