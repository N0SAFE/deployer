import { Effect } from "effect";

import { domainError } from "@deployer/effect-core";

/** A link could not be opened. */
export class LinkOpenFailed extends domainError("LinkOpenFailed", "dependency_missing")<{
  readonly target: string;
}>() {
  override publicMessage() {
    return `Could not open a link to ${this.target}`;
  }
}

export type LinkPoolOptions<C> = {
  readonly target: string;
  /** Connections kept open to the target. */
  readonly maxConnections: number;
  /** Calls and streams multiplexed on one connection before another one is opened. */
  readonly multiplex: number;
  readonly idleMs: number;
  readonly open: () => Promise<C>;
  readonly close: (connection: C) => Promise<void>;
  readonly healthy: (connection: C) => boolean;
  readonly now: () => number;
};

export type PooledLink<C> = {
  readonly connection: C;
  /** Gives the slot back; call it when the call or stream ends. */
  readonly release: () => void;
};

type Entry<C> = { connection: C; inFlight: number; lastUsed: number };

/**
 * The bounded set of RPC connections to one target.
 *
 * Calls are multiplexed: the least busy connection is reused, a new one opens only when every connection is full and
 * the cap allows it, idle ones close, and unhealthy ones are evicted. Callers see a link and release it; they never
 * see the pool.
 */
export function linkPool<C>(options: LinkPoolOptions<C>) {
  const entries: Entry<C>[] = [];
  let opening = 0;
  const pending = new Set<Promise<Entry<C>>>();

  const take = (entry: Entry<C>): PooledLink<C> => {
    entry.inFlight += 1;
    entry.lastUsed = options.now();
    let released = false;
    return {
      connection: entry.connection,
      release: () => {
        if (!released) {
          released = true;
          entry.inFlight -= 1;
          entry.lastUsed = options.now();
        }
      },
    };
  };

  const acquire = Effect.fn("LinkPool.acquire")(function* () {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry && !options.healthy(entry.connection)) {
        entries.splice(index, 1);
        void options.close(entry.connection).catch(() => undefined);
      }
    }

    const least = entries.reduce<Entry<C> | undefined>(
      (best, entry) => (best === undefined || entry.inFlight < best.inFlight ? entry : best),
      undefined,
    );
    if (least && (least.inFlight < options.multiplex || entries.length + opening >= options.maxConnections)) {
      return take(least);
    }

    // Every connection of the cap is already being opened: wait for one instead of opening past the cap.
    const waiting = [...pending][0];
    if (!least && entries.length + opening >= options.maxConnections && waiting) {
      return take(
        yield* Effect.tryPromise({ try: () => waiting, catch: (cause) => new LinkOpenFailed({ target: options.target, cause }) }),
      );
    }

    opening += 1;
    const opened: Promise<Entry<C>> = (async () => {
      try {
        const entry: Entry<C> = { connection: await options.open(), inFlight: 0, lastUsed: options.now() };
        entries.push(entry);
        return entry;
      } finally {
        opening -= 1;
      }
    })();
    pending.add(opened);
    const forget = () => void pending.delete(opened);
    opened.then(forget, forget);
    return take(
      yield* Effect.tryPromise({ try: () => opened, catch: (cause) => new LinkOpenFailed({ target: options.target, cause }) }),
    );
  });

  return {
    acquire,
    /** Closes the connections nobody has used for `idleMs`. Run it on a timer. */
    evictIdle: Effect.fn("LinkPool.evictIdle")(function* () {
      const now = options.now();
      const idle = entries.filter((entry) => entry.inFlight === 0 && now - entry.lastUsed >= options.idleMs);
      for (const entry of idle) {
        entries.splice(entries.indexOf(entry), 1);
        yield* Effect.promise(() => options.close(entry.connection).catch(() => undefined));
      }
      return idle.length;
    }),
    closeAll: Effect.fn("LinkPool.closeAll")(function* () {
      const all = entries.splice(0);
      yield* Effect.promise(() => Promise.all(all.map((entry) => options.close(entry.connection).catch(() => undefined))));
    }),
    size: () => entries.length,
  };
}
