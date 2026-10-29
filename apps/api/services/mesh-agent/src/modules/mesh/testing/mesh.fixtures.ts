import { Effect } from "effect";

import {
  MeshDirectoryRepository,
  createDirectoryStore,
  directoryRepositoryOver,
} from "../repositories/directory.repository";
import { MeshBroker } from "../services/broker.service";
import { MeshDirectory } from "../services/directory.service";
import { KeyHints, keyHintsOver } from "../services/key-hints.service";
import { MeshClock } from "../services/mesh-clock.service";
import { NodeIdentity } from "../services/node-identity.service";

import type { ReplicaRecord } from "../rules/replica-record";

export type MeshServices = MeshDirectoryRepository | NodeIdentity | MeshClock | MeshDirectory | KeyHints | MeshBroker;

/** A replica record; tests override only the field under assertion. */
export function replicaRecord(overrides: Partial<ReplicaRecord> = {}): ReplicaRecord {
  return {
    service: "project",
    replicaId: "project-1",
    nodeId: "A",
    address: "http://project-1",
    load: 0.2,
    keys: [],
    generation: 1,
    expiresAt: 11_000,
    ...overrides,
  };
}

/**
 * One agent's world: a node, a clock and an empty directory of its own. Every service is the real one; only the
 * three inputs (repository state, node identity, time) are the test's.
 */
export function meshFixture(options: { nodeId?: string; now?: number } = {}) {
  const clock = { now: options.now ?? 1_000 };
  const repository = directoryRepositoryOver(createDirectoryStore());
  const hints = keyHintsOver(new Map());

  const provide = <A, E>(effect: Effect.Effect<A, E, MeshServices>) =>
    effect.pipe(
      Effect.provideService(MeshDirectoryRepository, repository),
      Effect.provideService(NodeIdentity, { nodeId: options.nodeId ?? "A" }),
      Effect.provideService(MeshClock, { now: () => clock.now }),
      Effect.provideService(MeshDirectory, MeshDirectory.live),
      Effect.provideService(KeyHints, hints),
      Effect.provideService(MeshBroker, MeshBroker.live),
    );

  return {
    clock,
    /** Stores records exactly as given, as if gossip or an earlier registration had delivered them. */
    seed: (...records: readonly ReplicaRecord[]) =>
      Promise.all(records.map((record) => Effect.runPromise(repository.upsert(record)))),
    run: <A, E>(effect: Effect.Effect<A, E, MeshServices>) => Effect.runPromise(provide(effect)),
    /** The effect's success as `{ value }` or its typed failure as `{ error }`. */
    settle: <A, E>(effect: Effect.Effect<A, E, MeshServices>) =>
      Effect.runPromise(provide(effect).pipe(Effect.match({ onSuccess: (value) => ({ value }), onFailure: (error) => ({ error }) }))),
  };
}
