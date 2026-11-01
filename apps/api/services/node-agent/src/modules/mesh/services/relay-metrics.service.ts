import { Context, Effect } from "effect";

/** What the agent did with calls it could not answer directly. Additive on `node.status`, so an old reader ignores it. */
export type RelayCounters = {
  /** Calls handed to another agent because the direct link failed. */
  readonly forwarded: number;
  /** Calls that had no direct link and no next hop left: the target is unreachable from here. */
  readonly noRoute: number;
  /** Direct links that failed at the transport, and are now remembered as unreachable for a while. */
  readonly unreachable: number;
};

export type RelayMetricsShape = {
  readonly count: (counter: keyof RelayCounters) => Effect.Effect<void>;
  readonly snapshot: () => Effect.Effect<RelayCounters>;
};

/**
 * The relay's own counters for `node.status` and for an operator watching a partition.
 *
 * In memory, deliberately: they answer "what has this agent done since it started", which is the question asked while
 * diagnosing a route, and losing them on restart costs nothing.
 */
export class RelayMetrics extends Context.Service<RelayMetrics, RelayMetricsShape>()("node-agent/RelayMetrics") {
  static readonly live = class RelayMetricsImpl implements RelayMetricsShape {
    private readonly counters: { -readonly [K in keyof RelayCounters]: number } = {
      forwarded: 0,
      noRoute: 0,
      unreachable: 0,
    };

    count(counter: keyof RelayCounters) {
      return Effect.sync(() => {
        this.counters[counter] += 1;
      });
    }

    snapshot() {
      return Effect.sync(() => ({ ...this.counters }));
    }
  };
}
