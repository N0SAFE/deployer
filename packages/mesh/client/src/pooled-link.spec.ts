import { describe, expect, it, vi } from "vitest";

import { type PooledConnection, pooledLink } from "./pooled-link";

import type { ClientContext, ClientLink } from "@orpc/client";

type Connection = PooledConnection<ClientContext> & { id: number; calls: string[] };

function fixture(overrides: { maxConnections?: number; multiplex?: number; idleMs?: number } = {}) {
  let clock = 0;
  let next = 0;
  const opened: Connection[] = [];
  const closed: number[] = [];
  const open = vi.fn(() => {
    const id = (next += 1);
    const calls: string[] = [];
    const link: ClientLink<ClientContext> = {
      call: (path, input) => {
        calls.push(path.join("."));
        return Promise.resolve({ id, input });
      },
    };
    const connection: Connection = {
      id,
      calls,
      link,
      healthy: () => true,
      close: () => {
        closed.push(id);
        return Promise.resolve();
      },
    };
    opened.push(connection);
    return Promise.resolve(connection);
  });
  const link = pooledLink<ClientContext>({
    target: "agent-a",
    maxConnections: overrides.maxConnections ?? 2,
    multiplex: overrides.multiplex ?? 1,
    idleMs: overrides.idleMs ?? 1_000,
    open,
    now: () => clock,
  });
  return { link, open, opened, closed, advance: (ms: number) => (clock += ms) };
}

async function* streamOf<T>(...values: T[]): AsyncGenerator<T> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

const call = (link: ReturnType<typeof fixture>["link"], path = ["ping"], input: unknown = {}) => link.call(path, input, { context: {} });

describe("pooledLink", () => {
  it("opens a connection on first use and reuses it once the call settled", async () => {
    const { link, open } = fixture();

    await call(link);
    await call(link);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens a second connection while the first one is busy with a stream", async () => {
    const { link, open, opened } = fixture();
    opened.length = 0;
    const stream = streamOf(1);
    open.mockImplementationOnce(() =>
      Promise.resolve({
        id: 99,
        calls: [],
        link: { call: () => Promise.resolve(stream) },
        healthy: () => true,
        close: () => Promise.resolve(),
      } as Connection),
    );

    const held = (await call(link)) as AsyncIterator<number>;
    await call(link);

    expect(open).toHaveBeenCalledTimes(2);
    await held.return?.();
  });

  it("holds the connection until the stream ends, then lets the next call reuse it", async () => {
    const { link, open } = fixture({ maxConnections: 1, multiplex: 1 });
    const source = streamOf(1, 2);
    open.mockImplementationOnce(() =>
      Promise.resolve({
        id: 7,
        calls: [],
        link: { call: vi.fn().mockResolvedValueOnce(source).mockResolvedValue("plain") },
        healthy: () => true,
        close: () => Promise.resolve(),
      } as Connection),
    );

    const stream = (await call(link)) as AsyncIterator<number>;
    const values: number[] = [];
    for (let step = await stream.next(); !step.done; step = await stream.next()) {
      values.push(step.value);
    }
    const after = await call(link);

    expect(values).toEqual([1, 2]);
    expect(after).toBe("plain");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("releases the connection when a stream is abandoned early", async () => {
    const { link, open } = fixture({ maxConnections: 1, multiplex: 1 });
    const source = streamOf(1, 2);
    const inner = { call: vi.fn().mockResolvedValueOnce(source).mockResolvedValue("done") };
    open.mockImplementationOnce(() =>
      Promise.resolve({ id: 8, calls: [], link: inner, healthy: () => true, close: () => Promise.resolve() } as Connection),
    );

    const stream = (await call(link)) as AsyncIterator<number>;
    await stream.next();
    await stream.return?.();

    await expect(call(link)).resolves.toBe("done");
  });

  it("releases the connection when a call fails and rethrows the failure", async () => {
    const { link, open } = fixture({ maxConnections: 1, multiplex: 1 });
    const inner = { call: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok") };
    open.mockImplementationOnce(() =>
      Promise.resolve({ id: 9, calls: [], link: inner, healthy: () => true, close: () => Promise.resolve() } as Connection),
    );

    await expect(call(link)).rejects.toThrow("boom");
    await expect(call(link)).resolves.toBe("ok");
  });

  it("fails the call when no connection can be opened", async () => {
    const link = pooledLink<ClientContext>({
      target: "agent-a",
      maxConnections: 1,
      multiplex: 1,
      idleMs: 1_000,
      open: () => Promise.reject(new Error("refused")),
    });

    await expect(call(link)).rejects.toMatchObject({ _tag: "LinkOpenFailed", target: "agent-a" });
  });

  it("closes idle connections and everything on shutdown", async () => {
    const { link, closed, advance } = fixture();
    await call(link);

    advance(1_000);
    expect(await link.evictIdle()).toBe(1);
    await call(link);
    await link.closeAll();

    expect(closed).toEqual([1, 2]);
    expect(link.size()).toBe(0);
  });
});
