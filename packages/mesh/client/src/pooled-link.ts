import { runPromiseUnwrapped } from "@deployer/effect-core";

import { type LinkPoolOptions, linkPool } from "./pool/link-pool";

import type { ClientContext, ClientLink, ClientOptions } from "@orpc/client";

/** One open connection to a target: the oRPC link over it, how to close it, and whether it is still usable. */
export type PooledConnection<C extends ClientContext> = {
  readonly link: ClientLink<C>;
  readonly close: () => Promise<void>;
  readonly healthy: () => boolean;
};

export type PooledLinkOptions<C extends ClientContext> = Pick<LinkPoolOptions<never>, "target" | "maxConnections" | "multiplex" | "idleMs"> & {
  readonly open: () => Promise<PooledConnection<C>>;
  readonly now?: () => number;
};

/** A `ClientLink` that owns a bounded pool of connections to one target. */
export type PooledLink<C extends ClientContext> = ClientLink<C> & {
  /** Closes the connections nobody has used for `idleMs`. Run it on a timer. */
  readonly evictIdle: () => Promise<number>;
  readonly closeAll: () => Promise<void>;
  readonly size: () => number;
};

const isAsyncIterator = (value: unknown): value is AsyncIterator<unknown> =>
  typeof value === "object" && value !== null && "next" in value && typeof value.next === "function";

/** Gives the connection back when the stream ends, however it ends: exhausted, returned early, or thrown. */
function releaseWhenDone<T extends AsyncIterator<unknown>>(iterator: T, release: () => void): T {
  const finish = <R>(result: R): R => {
    release();
    return result;
  };
  return new Proxy(iterator, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property === "next" && typeof value === "function") {
        return async (...args: unknown[]) => {
          try {
            const result = (await (value as (...a: unknown[]) => Promise<IteratorResult<unknown>>).apply(target, args));
            return result.done ? finish(result) : result;
          } catch (error) {
            release();
            throw error;
          }
        };
      }
      if ((property === "return" || property === "throw") && typeof value === "function") {
        return async (...args: unknown[]) => {
          try {
            return await (value as (...a: unknown[]) => Promise<IteratorResult<unknown>>).apply(target, args);
          } finally {
            release();
          }
        };
      }
      if (property === Symbol.asyncIterator) {
        return () => target;
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * The persistent RPC link every mesh caller uses.
 *
 * Calls and streams are multiplexed over a few connections: the least busy one is reused, a new one opens only when
 * every connection is full and the cap allows it, idle connections close, and unhealthy ones are evicted. A call holds
 * its connection until it settles; a stream holds it until the stream ends. Callers see a link, never the pool.
 */
export function pooledLink<C extends ClientContext>(options: PooledLinkOptions<C>): PooledLink<C> {
  const now = options.now ?? (() => Date.now());
  const pool = linkPool<PooledConnection<C>>({
    target: options.target,
    maxConnections: options.maxConnections,
    multiplex: options.multiplex,
    idleMs: options.idleMs,
    open: options.open,
    close: (connection) => connection.close(),
    healthy: (connection) => connection.healthy(),
    now,
  });

  return {
    async call(path: string[], input: unknown, callOptions: ClientOptions<C>) {
      const lease = await runPromiseUnwrapped(pool.acquire());
      try {
        const result = await lease.connection.link.call(path, input, callOptions);
        if (isAsyncIterator(result)) {
          return releaseWhenDone(result, lease.release);
        }
        lease.release();
        return result;
      } catch (error) {
        lease.release();
        throw error;
      }
    },
    evictIdle: () => runPromiseUnwrapped(pool.evictIdle()),
    closeAll: () => runPromiseUnwrapped(pool.closeAll()),
    size: pool.size,
  };
}
