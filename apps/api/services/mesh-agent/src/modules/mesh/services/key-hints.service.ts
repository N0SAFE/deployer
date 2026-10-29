import { Context, Effect } from "effect";

import { MeshClock } from "./mesh-clock.service";

export type KeyHintsShape = {
  readonly remember: (service: string, key: string, replicaId: string, ttlMs: number) => Effect.Effect<void, never, MeshClock>;
  readonly lookup: (service: string, key: string) => Effect.Effect<string | undefined, never, MeshClock>;
};

/** `key -> replica` hints, so the call after a redirect goes straight to the replica that answered. They only ever speed things up: a stale hint costs one redirect. */
export function keyHintsOver(entries: Map<string, { replicaId: string; expiresAt: number }>): KeyHintsShape {
  const id = (service: string, key: string) => `${service}\u0000${key}`;
  return {
    remember: Effect.fn("KeyHints.remember")(function* (service: string, key: string, replicaId: string, ttlMs: number) {
      const clock = yield* MeshClock;
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

export class KeyHints extends Context.Service<KeyHints, KeyHintsShape>()("mesh-agent/KeyHints") {
  static readonly live: KeyHintsShape = keyHintsOver(new Map());
}
