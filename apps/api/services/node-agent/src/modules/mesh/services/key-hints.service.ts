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

/** `key -> replica` hints, so the call after a redirect goes straight to the replica that answered. They only ever speed things up: a stale hint costs one redirect. */
export function keyHintsOver(
  entries: Map<string, { replicaId: string; expiresAt: number }>,
  capacity = MAX_HINTS,
): KeyHintsShape {
  const id = (service: string, key: string) => `${service}\u0000${key}`;
  return {
    remember: Effect.fn("KeyHints.remember")(function* (service: string, key: string, replicaId: string, ttlMs: number) {
      const clock = yield* MeshClock;
      // A key already held is refreshed in place, so a busy key never evicts anything.
      if (!entries.has(id(service, key))) {
        while (entries.size >= capacity) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      }
      entries.set(id(service, key), { replicaId, expiresAt: clock.now() + ttlMs });
    }),
    lookup: Effect.fn("KeyHints.lookup")(function* (service: string, key: string) {
      const clock = yield* MeshClock;
      const entry = entries.get(id(service, key));
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= clock.now()) {
        entries.delete(id(service, key));
        return undefined;
      }
      return entry.replicaId;
    }),
  };
}

export class KeyHints extends Context.Service<KeyHints, KeyHintsShape>()("node-agent/KeyHints") {
  static readonly live: KeyHintsShape = keyHintsOver(new Map());
}
