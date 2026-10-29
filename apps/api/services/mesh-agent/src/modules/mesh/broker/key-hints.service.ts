import { Context, Effect } from "effect";

export type KeyHintsShape = {
  readonly remember: (service: string, key: string, replicaId: string, now: number, ttlMs: number) => Effect.Effect<void>;
  readonly lookup: (service: string, key: string, now: number) => Effect.Effect<string | undefined>;
};

/** `key -> replica` hints, so the call after a redirect goes straight to the replica that answered. They only ever speed things up: a stale hint costs one redirect. */
export function keyHintsOver(entries: Map<string, { replicaId: string; expiresAt: number }>): KeyHintsShape {
  const id = (service: string, key: string) => `${service}\u0000${key}`;
  return {
    remember: (service, key, replicaId, now, ttlMs) =>
      Effect.sync(() => {
        entries.set(id(service, key), { replicaId, expiresAt: now + ttlMs });
      }),
    lookup: (service, key, now) =>
      Effect.sync(() => {
        const entry = entries.get(id(service, key));
        if (!entry) {
          return undefined;
        }
        if (entry.expiresAt <= now) {
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
