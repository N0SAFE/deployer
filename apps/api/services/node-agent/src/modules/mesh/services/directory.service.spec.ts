import { describe, expect, it } from "vitest";

import { replicaRecord, meshFixture } from "../testing/mesh.fixtures";

import { MeshDirectory, type ReplicaRegistration } from "./directory.service";

const registration = (overrides: Partial<ReplicaRegistration> = {}): ReplicaRegistration => ({
  service: "runtime",
  replicaId: "runtime-1",
  address: "http://runtime-1",
  load: 0.1,
  keys: [],
  ttlMs: 5_000,
  ...overrides,
});

const register = (input: ReplicaRegistration) => new MeshDirectory.live().register(input);

describe("MeshDirectory", () => {
  it("stamps the agent's node, a first generation and an expiry from its own clock", async () => {
    const mesh = meshFixture({ nodeId: "B", now: 1_000 });

    const record = await mesh.run(register(registration()));

    expect(record).toMatchObject({ nodeId: "B", generation: 1, expiresAt: 6_000 });
  });

  it("bumps the generation and extends the lease when the same replica refreshes", async () => {
    const mesh = meshFixture({ now: 1_000 });
    await mesh.run(register(registration()));

    mesh.clock.now = 3_000;
    const refreshed = await mesh.run(register(registration({ keys: ["stream-1"] })));

    expect(refreshed).toMatchObject({ generation: 2, expiresAt: 8_000, keys: ["stream-1"] });
  });

  it("resolves a registered replica", async () => {
    const mesh = meshFixture();
    await mesh.run(register(registration()));

    const result = await mesh.settle(new MeshDirectory.live().resolve({ service: "runtime" }));

    expect(result).toMatchObject({ value: { reason: "local-node", replica: { replicaId: "runtime-1" } } });
  });

  it("fails with the service when no replica is known", async () => {
    const mesh = meshFixture();

    const result = await mesh.settle(new MeshDirectory.live().resolve({ service: "runtime" }));

    expect(result).toMatchObject({ error: { _tag: "MeshNoReplica", service: "runtime" } });
  });

  it("ages a silent replica out", async () => {
    const mesh = meshFixture({ now: 1_000 });
    await mesh.run(register(registration({ ttlMs: 1_000 })));

    mesh.clock.now = 2_000;
    const snapshot = await mesh.run(new MeshDirectory.live().snapshot());

    expect(snapshot).toEqual([]);
  });

  it("unregisters a replica and reports whether it was known", async () => {
    const mesh = meshFixture();
    await mesh.run(register(registration()));

    const first = await mesh.run(new MeshDirectory.live().unregister("runtime-1"));
    const second = await mesh.run(new MeshDirectory.live().unregister("runtime-1"));

    expect([first, second]).toEqual([true, false]);
  });

  it("serves a gossiped replica from another node when none is local", async () => {
    const mesh = meshFixture({ nodeId: "A" });
    await mesh.seed(replicaRecord({ service: "runtime", replicaId: "runtime-3", nodeId: "C" }));

    const result = await mesh.settle(new MeshDirectory.live().resolve({ service: "runtime" }));

    expect(result).toMatchObject({ value: { replica: { nodeId: "C" } } });
  });
});
