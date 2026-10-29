export type GossipLoopOptions = {
  /** Websocket URLs of agents to learn the mesh from. */
  readonly seeds: readonly string[];
  /** Learns from one seed; `true` when it taught this agent something new. Never throws. */
  readonly seed: (address: string) => Promise<boolean>;
  /** One gossip round with every known agent. Never throws. */
  readonly round: () => Promise<unknown>;
  readonly intervalMs: number;
};

export type GossipLoop = {
  readonly stop: () => void;
};

/**
 * Keeps an agent's view of the mesh fresh: seeds first, then rounds, until stopped.
 *
 * Seeds are retried every round until each has answered once, because a seed that is down at boot is the normal case in
 * a cluster that is starting all at once. Once every seed has been reached, only rounds run: the agents they taught this
 * one are asked directly from then on, so losing a seed later costs nothing.
 */
export function startGossipLoop(options: GossipLoopOptions): GossipLoop {
  const pending = new Set(options.seeds);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    for (const address of [...pending]) {
      if (stopped) {
        return;
      }
      if (await options.seed(address)) {
        pending.delete(address);
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
