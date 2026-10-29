export type GossipLoopOptions = {
  /** The seeds that have not answered yet, read every round: an agent can be pointed at a swarm at any time. */
  readonly pending: () => Promise<readonly string[]>;
  /** Learns from one seed; `reached` when it answered. Never throws. */
  readonly seed: (address: string) => Promise<{ readonly reached: boolean }>;
  /** A seed answered: it is not retried. */
  readonly reached: (address: string) => Promise<void>;
  /** One gossip round with every known agent. Never throws. */
  readonly round: () => Promise<unknown>;
  readonly intervalMs: number;
};

export type GossipLoop = {
  readonly stop: () => void;
};

/**
 * Keeps an agent's view of the mesh fresh: pending seeds first, then rounds, until stopped.
 *
 * An agent with no seeds is the normal first state, not a fault: it serves its own node from memory and the loop only
 * has nobody to ask. Seeds are read every round, so one added later (the node joined a swarm) is tried at the next
 * tick, and one that is down is retried until it answers. Once a seed has answered, the agents it taught this one are
 * asked directly, so losing that seed later costs nothing.
 */
export function startGossipLoop(options: GossipLoopOptions): GossipLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    for (const address of await options.pending()) {
      if (stopped) {
        return;
      }
      if ((await options.seed(address)).reached) {
        await options.reached(address);
      }
    }
    if (!stopped) {
      await options.round();
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), options.intervalMs);
      timer.unref();
    }
  };

  void tick();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
