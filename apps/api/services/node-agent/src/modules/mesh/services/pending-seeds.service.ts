import { Context, Effect } from "effect";

export type PendingSeedsShape = {
  /** An agent to learn the mesh from. Adding one the agent is already pursuing changes nothing. */
  readonly add: (address: string) => Effect.Effect<void>;
  /** A seed that answered: it is not retried. */
  readonly reached: (address: string) => Effect.Effect<void>;
  /** The seeds that have not answered yet, retried every round. */
  readonly pending: () => Effect.Effect<readonly string[]>;
};

export function pendingSeedsOver(addresses: Set<string>): PendingSeedsShape {
  return {
    add: (address) => Effect.sync(() => void addresses.add(address)),
    reached: (address) => Effect.sync(() => void addresses.delete(address)),
    pending: () => Effect.sync(() => [...addresses]),
  };
}

/**
 * The agents this one is trying to join. Empty for an agent that has not been pointed at a swarm yet, which is a normal
 * and fully working state: it serves its own node's replicas from memory, and joining happens whenever a seed is added.
 */
export class PendingSeeds extends Context.Service<PendingSeeds, PendingSeedsShape>()("node-agent/PendingSeeds") {
  static readonly live: PendingSeedsShape = pendingSeedsOver(new Set());
}
