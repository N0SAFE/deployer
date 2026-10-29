import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { linkPool } from "./link-pool";

type Connection = { id: number; open: boolean };

function fixture(overrides: { maxConnections?: number; multiplex?: number; idleMs?: number } = {}) {
  let clock = 0;
  let next = 0;
  const closed: number[] = [];
  const open = vi.fn(() => Promise.resolve<Connection>({ id: (next += 1), open: true }));
  const pool = linkPool<Connection>({
    target: "agent-b",
    maxConnections: overrides.maxConnections ?? 2,
    multiplex: overrides.multiplex ?? 2,
    idleMs: overrides.idleMs ?? 1_000,
    open,
    close: (connection) => {
      closed.push(connection.id);
      return Promise.resolve();
    },
    healthy: (connection) => connection.open,
    now: () => clock,
  });
  return { pool, open, closed, advance: (ms: number) => (clock += ms) };
}

const acquire = (pool: ReturnType<typeof fixture>["pool"]) => Effect.runPromise(pool.acquire());

describe("linkPool", () => {
  it("multiplexes calls on one connection before opening another", async () => {
    const { pool, open } = fixture();

    const first = await acquire(pool);
    const second = await acquire(pool);
    const third = await acquire(pool);

    expect(open).toHaveBeenCalledTimes(2);
    expect([first.connection.id, second.connection.id, third.connection.id]).toEqual([1, 1, 2]);
  });

  it("never opens past the cap and shares the least busy connection instead", async () => {
    const { pool, open } = fixture({ maxConnections: 1, multiplex: 1 });

    const first = await acquire(pool);
    const second = await acquire(pool);

    expect(open).toHaveBeenCalledTimes(1);
    expect(second.connection).toBe(first.connection);
  });

  it("reuses a connection once its slot is released", async () => {
    const { pool, open } = fixture({ multiplex: 1 });

    const first = await acquire(pool);
    first.release();
    const second = await acquire(pool);

    expect(open).toHaveBeenCalledTimes(1);
    expect(second.connection.id).toBe(1);
  });

  it("releases a slot only once", async () => {
    const { pool } = fixture({ multiplex: 1, maxConnections: 2 });

    const first = await acquire(pool);
    first.release();
    first.release();
    const second = await acquire(pool);
    const third = await acquire(pool);

    expect([second.connection.id, third.connection.id]).toEqual([1, 2]);
  });

  it("evicts an unhealthy connection and opens a new one", async () => {
    const { pool, open, closed } = fixture();

    const first = await acquire(pool);
    first.connection.open = false;
    const second = await acquire(pool);

    expect(second.connection.id).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
    expect(closed).toEqual([1]);
  });

  it("closes only the connections idle for long enough", async () => {
    const { pool, closed, advance } = fixture({ multiplex: 1, idleMs: 1_000 });

    const busy = await acquire(pool);
    const idle = await acquire(pool);
    idle.release();
    advance(1_000);
    const evicted = await Effect.runPromise(pool.evictIdle());

    expect(evicted).toBe(1);
    expect(closed).toEqual([2]);
    expect(pool.size()).toBe(1);
    expect(busy.connection.id).toBe(1);
  });

  it("fails with the target when a connection cannot be opened", async () => {
    const pool = linkPool<Connection>({
      target: "agent-b",
      maxConnections: 1,
      multiplex: 1,
      idleMs: 1_000,
      open: () => Promise.reject(new Error("refused")),
      close: () => Promise.resolve(),
      healthy: () => true,
      now: () => 0,
    });

    const error = await Effect.runPromise(pool.acquire().pipe(Effect.flip));

    expect(error).toMatchObject({ _tag: "LinkOpenFailed", target: "agent-b" });
    expect(pool.size()).toBe(0);
  });

  it("closes every connection", async () => {
    const { pool, closed } = fixture();
    await acquire(pool);

    await Effect.runPromise(pool.closeAll());

    expect(closed).toEqual([1]);
    expect(pool.size()).toBe(0);
  });

  it("waits for a connection that is being opened instead of opening past the cap", async () => {
    const { pool, open } = fixture({ maxConnections: 1, multiplex: 8 });

    const all = await Promise.all([acquire(pool), acquire(pool), acquire(pool)]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(new Set(all.map((link) => link.connection.id)).size).toBe(1);
  });
});
