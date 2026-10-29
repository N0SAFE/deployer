import { Effect } from "effect";

import { MeshDirectory } from "../directory/directory.service";

import { MeshNoReplica, MeshRedirectExhausted } from "./broker.errors";
import { KeyHints } from "./key-hints.service";

import type { ReplicaRecord } from "../directory/replica-record";

/**
 * What one attempt on one replica came to. The wire layer maps the oRPC error code `MESH_REDIRECT` to `redirect`,
 * so the broker works on data and never has to inspect an error union.
 */
export type CallOutcome<A> =
  | { readonly kind: "ok"; readonly value: A }
  | { readonly kind: "redirect"; readonly replicaId: string; readonly reason: string };

export type BrokerInput<A, E, R> = {
  readonly service: string;
  readonly key?: string;
  readonly localNode: string;
  readonly maxHops: number;
  readonly hintTtlMs: number;
  readonly now: () => number;
  readonly invoke: (replica: ReplicaRecord) => Effect.Effect<CallOutcome<A>, E, R>;
};

/**
 * Sends a call to the right replica and answers `MESH_REDIRECT` itself.
 *
 * The caller never sees a redirect: the agent resolves the named replica, replays the call there, and stops after
 * `maxHops` or when only replicas it already tried are left. A key that was served by a replica is remembered, so
 * the next call for it skips the detour.
 */
export function brokerCall<A, E, R>(input: BrokerInput<A, E, R>) {
  return Effect.gen(function* () {
    const directory = yield* MeshDirectory;
    const hints = yield* KeyHints;
    const visited = new Set<string>();

    const attempt = (replica: ReplicaRecord, hop: number): Effect.Effect<A, E | MeshNoReplica | MeshRedirectExhausted, R> =>
      Effect.gen(function* () {
        visited.add(replica.replicaId);
        const outcome = yield* input.invoke(replica);

        if (outcome.kind === "ok") {
          if (input.key !== undefined) {
            yield* hints.remember(input.service, input.key, replica.replicaId, input.now(), input.hintTtlMs);
          }
          return outcome.value;
        }

        if (hop + 1 > input.maxHops) {
          return yield* new MeshRedirectExhausted({ service: input.service, hops: hop + 1 });
        }

        const named = yield* directory.get(outcome.replicaId, input.now());
        const next =
          named && !visited.has(named.replicaId)
            ? named
            : (yield* directory.resolve({
                service: input.service,
                key: input.key,
                localNode: input.localNode,
                exclude: [...visited],
                now: input.now(),
              }))?.replica;

        if (!next) {
          return yield* new MeshRedirectExhausted({ service: input.service, hops: hop + 1 });
        }
        return yield* attempt(next, hop + 1);
      });

    const hinted =
      input.key === undefined ? undefined : yield* hints.lookup(input.service, input.key, input.now());
    const hintedReplica = hinted === undefined ? undefined : yield* directory.get(hinted, input.now());

    const first =
      hintedReplica ??
      (yield* directory.resolve({
        service: input.service,
        key: input.key,
        localNode: input.localNode,
        now: input.now(),
      }))?.replica;

    if (!first) {
      return yield* new MeshNoReplica({ service: input.service });
    }
    return yield* attempt(first, 0);
  });
}
