import { Effect, Schedule } from "effect";

import type { ClientContext, ClientLink } from "@orpc/client";

export type ReplicaHeartbeatOptions = {
  /** The persistent link to the local mesh-agent. */
  readonly agent: ClientLink<ClientContext>;
  readonly service: string;
  readonly replicaId: string;
  /** Where this replica's RPC endpoint answers on the overlay network. */
  readonly address: string;
  /** The resources this replica holds right now, read at every beat so a deployment that starts is announced within one. */
  readonly keys: () => readonly string[];
  /** 0 (idle) to 1 (saturated). */
  readonly load: () => number;
  readonly intervalMs: number;
  /** How long a registration lives without the next beat. Several intervals, so one missed beat is not a death. */
  readonly ttlMs: number;
};

/**
 * A replica tells its local agent that it is alive, over and over, until the effect is interrupted.
 *
 * Each beat registers the replica with the keys and load it has now; the agent stamps the node, bumps the generation
 * and sets the expiry. A failed beat is not an error: the agent may be restarting, and the next beat retries. A replica
 * that dies simply stops beating and ages out of every directory.
 */
export function replicaHeartbeat(options: ReplicaHeartbeatOptions): Effect.Effect<void> {
  const beat = Effect.tryPromise({
    try: () =>
      options.agent.call(
        ["directory", "register"],
        {
          service: options.service,
          replicaId: options.replicaId,
          address: options.address,
          load: options.load(),
          keys: [...options.keys()],
          ttlMs: options.ttlMs,
        },
        { context: {} },
      ),
    catch: (error) => error,
  }).pipe(Effect.ignore);

  return beat.pipe(Effect.repeat(Schedule.spaced(options.intervalMs)), Effect.asVoid);
}
