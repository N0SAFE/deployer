import { Context, Effect } from "effect";

import { MeshClock } from "./mesh-clock.service";

export type KeyHintsShape = {
  readonly remember: (service: string, key: string, replicaId: string, ttlMs: number) => Effect.Effect<void, never, MeshClock>;
  readonly lookup: (service: string, key: string) => Effect.Effect<string | undefined, never, MeshClock>;
};

/**
 * How many hints one agent keeps. A hint is a shortcut, never data: the oldest is dropped when the cap is reached, and a
 * dropped hint costs one redirect. Without the cap, a caller naming a distinct key per call would grow this forever.
 */
const MAX_HINTS = 10_000;

/** One key space for the map: a service and a key cannot be confused with each other's. */
const hintId = (service: string, key: string): string => `${service}\u0000${key}`;

/** `key -> replica` hints, so the call after a redirect goes straight to the replica that answered. They only ever speed things up: a stale hint costs one redirect. */
export class KeyHints extends Context.Service<KeyHints, KeyHintsShape>()("node-agent/KeyHints") {
  static readonly live = class KeyHintsImpl implements KeyHintsShape {
    private readonly entries: Map<string, { replicaId: string; expiresAt: number }>;
    private readonly capacity: number;

    constructor(
      entries = new Map<string, { replicaId: string; expiresAt: number }>(),
      capacity: number = MAX_HINTS,
    ) {
      this.entries = entries;
      this.capacity = capacity;
    }

    remember(service: string, key: string, replicaId: string, ttlMs: number) {
      const entries = this.entries;
      const capacity = this.capacity;
      const id = hintId(service, key);
      return Effect.gen(function* () {
        const clock = yield* MeshClock;
        // A key already held is refreshed in place, so a busy key never evicts anything.
        if (!entries.has(id)) {
          while (entries.size >= capacity) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            entries.delete(oldest);
          }
        }
        entries.set(id, { replicaId, expiresAt: clock.now() + ttlMs });
      });
    }

    lookup(service: string, key: string) {
      const entries = this.entries;
      const id = hintId(service, key);
      return Effect.gen(function* () {
        const clock = yield* MeshClock;
        const entry = entries.get(id);
        if (!entry) {
          return undefined;
        }
        if (entry.expiresAt <= clock.now()) {
          entries.delete(id);
          return undefined;
        }
        return entry.replicaId;
      });
    }
  };
}
