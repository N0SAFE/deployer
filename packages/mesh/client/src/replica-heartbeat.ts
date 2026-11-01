import { Effect, Schedule } from "effect";

import type { ClientContext, ClientLink } from "@orpc/client";

export type ReplicaHeartbeatOptions = {
  /** The persistent link to the local node-agent. */
  readonly agent: ClientLink<ClientContext>;
  readonly service: string;
  readonly replicaId: string;
  /** Where this replica's RPC endpoint answers on the overlay network. */
  readonly address: string;
  /** The resources this replica holds right now, read at every beat so a deployment that starts is announced within one. */
  readonly keys: () => readonly string[] | Promise<readonly string[]>;
  /** 0 (idle) to 1 (saturated). */
  readonly load: () => number;
  readonly intervalMs: number;
  /** How long a registration lives without the next beat. Several intervals, so one missed beat is not a death. */
  readonly ttlMs: number;
  /**
   * Called at most once, with the first failed registration, and only on a failure. A service that found an agent socket
   * and cannot reach it is not silent about it, and a beat that keeps failing is the same problem, not a new one.
   */
  readonly onRegistrationFailure?: (error: unknown) => void;
};

/**
 * A replica tells its local agent that it is alive, over and over, until the effect is interrupted.
 *
 * Each beat registers the replica with the keys and load it has now; the agent stamps the node, bumps the generation
 * and sets the expiry. A failed beat is not an error: the agent may be restarting, and the next beat retries. A replica
 * that dies simply stops beating and ages out of every directory.
 */
export function replicaHeartbeat(options: ReplicaHeartbeatOptions): Effect.Effect<void> {
  let reported = false;
  const beat = Effect.tryPromise({
    try: async () =>
      options.agent.call(
        ["directory", "register"],
        {
          service: options.service,
          replicaId: options.replicaId,
          address: options.address,
          load: options.load(),
          // Read at every beat, and awaited: a replica that has to ask its engine what it holds can.
          keys: [...(await options.keys())],
          ttlMs: options.ttlMs,
        },
        { context: {} },
      ),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (reported) return;
        reported = true;
        options.onRegistrationFailure?.(error);
      }),
    ),
  );

  return beat.pipe(Effect.repeat(Schedule.spaced(options.intervalMs)), Effect.asVoid);
}
