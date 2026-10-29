import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createDirectoryStore } from "./directory-store";
import { directoryOver } from "./directory.service";

import type { ReplicaRecord } from "./replica-record";

const record = (overrides: Partial<ReplicaRecord> = {}): ReplicaRecord => ({
  service: "runtime",
  replicaId: "runtime-1",
  nodeId: "A",
  address: "http://runtime-1",
  load: 0.1,
  keys: [],
  generation: 1,
  expiresAt: 5_000,
  ...overrides,
});

const directory = () => directoryOver(createDirectoryStore());

describe("MeshDirectory", () => {
  it("registers a replica and resolves it", async () => {
    const dir = directory();
    await Effect.runPromise(dir.register(record()));

    const resolution = await Effect.runPromise(dir.resolve({ service: "runtime", localNode: "A", now: 1_000 }));

    expect(resolution?.replica.replicaId).toBe("runtime-1");
  });

  it("ignores a stale generation and keeps the newer record", async () => {
    const dir = directory();
    await Effect.runPromise(dir.register(record({ generation: 3, keys: ["stream-1"] })));

    const changed = await Effect.runPromise(dir.register(record({ generation: 2, keys: [] })));
    const current = await Effect.runPromise(dir.get("runtime-1", 1_000));

    expect(changed).toBe(false);
    expect(current?.keys).toEqual(["stream-1"]);
  });

  it("extends the lease on an equal generation and reports a change only when it does", async () => {
    const dir = directory();
    await Effect.runPromise(dir.register(record()));

    const extended = await Effect.runPromise(dir.register(record({ expiresAt: 9_000 })));
    const repeated = await Effect.runPromise(dir.register(record({ expiresAt: 9_000 })));

    expect([extended, repeated]).toEqual([true, false]);
  });

  it("ages a silent replica out", async () => {
    const dir = directory();
    await Effect.runPromise(dir.register(record({ expiresAt: 2_000 })));

    const live = await Effect.runPromise(dir.snapshot(1_999));
    const dead = await Effect.runPromise(dir.snapshot(2_000));

    expect([live.length, dead.length]).toEqual([1, 0]);
  });

  it("forgets an unregistered replica", async () => {
    const dir = directory();
    await Effect.runPromise(dir.register(record()));
    await Effect.runPromise(dir.unregister("runtime-1"));

    expect(await Effect.runPromise(dir.get("runtime-1", 1_000))).toBeUndefined();
  });
});
