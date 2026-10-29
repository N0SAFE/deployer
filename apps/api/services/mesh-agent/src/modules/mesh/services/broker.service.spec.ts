import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { meshFixture, replicaRecord } from "../testing/mesh.fixtures";

import { type CallOutcome, MeshBroker } from "./broker.service";

import type { ReplicaRecord } from "../rules/replica-record";

const project = (replicaId: string, nodeId: string) => replicaRecord({ replicaId, nodeId });

async function setup(...records: ReplicaRecord[]) {
  const mesh = meshFixture({ nodeId: "A" });
  await mesh.seed(...records);
  return mesh;
}

const call = <A, E>(
  invoke: (replica: ReplicaRecord) => Effect.Effect<CallOutcome<A>, E>,
  overrides: { key?: string; maxHops?: number } = {},
) =>
  MeshBroker.live.call({ service: "project", key: overrides.key, maxHops: overrides.maxHops ?? 3, hintTtlMs: 5_000, invoke });

const ok = <A>(value: A): CallOutcome<A> => ({ kind: "ok", value });
const redirect = (replicaId: string): CallOutcome<never> => ({ kind: "redirect", replicaId, reason: "holds the deployment" });

describe("MeshBroker", () => {
  it("serves the local replica without crossing nodes", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-2", "B"));
    const invoke = vi.fn((target: ReplicaRecord) => Effect.succeed(ok(target.replicaId)));

    const result = await mesh.settle(call(invoke));

    expect(result).toEqual({ value: "project-1" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("answers a redirect itself and returns the final result to the caller", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-3", "C"));
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-3") : ok(`served by ${target.replicaId}`)),
    );

    const result = await mesh.settle(call(invoke));

    expect(result).toEqual({ value: "served by project-3" });
    expect(invoke.mock.calls.map(([target]) => target.replicaId)).toEqual(["project-1", "project-3"]);
  });

  it("remembers the replica that served a key so the next call skips the detour", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-3", "C"));
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-3") : ok(target.replicaId)),
    );

    await mesh.settle(call(invoke, { key: "deploy-7" }));
    invoke.mockClear();
    const second = await mesh.settle(call(invoke, { key: "deploy-7" }));

    expect(second).toEqual({ value: "project-3" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("forgets a hint once it has expired", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-3", "C"));
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-3") : ok(target.replicaId)),
    );
    await mesh.settle(call(invoke, { key: "deploy-7" }));
    invoke.mockClear();

    mesh.clock.now += 5_000;
    await mesh.settle(call(invoke, { key: "deploy-7" }));

    expect(invoke.mock.calls.map(([target]) => target.replicaId)).toEqual(["project-1", "project-3"]);
  });

  it("stops at the hop limit when replicas keep redirecting", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-2", "B"), project("project-3", "C"));
    const next: Record<string, string> = { "project-1": "project-2", "project-2": "project-3", "project-3": "project-1" };

    const result = await mesh.settle(call((target) => Effect.succeed(redirect(next[target.replicaId] ?? "project-1")), { maxHops: 1 }));

    expect(result).toMatchObject({ error: { _tag: "MeshRedirectExhausted", hops: 2 } });
  });

  it("does not loop back to a replica it already tried", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-2", "B"));
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-2") : redirect("project-1")),
    );

    const result = await mesh.settle(call(invoke));

    expect(result).toMatchObject({ error: { _tag: "MeshRedirectExhausted" } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("resolves again when the redirect names a replica the directory no longer knows", async () => {
    const mesh = await setup(project("project-1", "A"), project("project-2", "B"));
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-9") : ok(target.replicaId)),
    );

    const result = await mesh.settle(call(invoke));

    expect(result).toEqual({ value: "project-2" });
  });

  it("fails when no replica of the service is known", async () => {
    const mesh = await setup();

    const result = await mesh.settle(call((target) => Effect.succeed(ok(target.replicaId))));

    expect(result).toMatchObject({ error: { _tag: "MeshNoReplica", service: "project" } });
  });

  it("passes the transport failure of an attempt through unchanged", async () => {
    const mesh = await setup(project("project-1", "A"));

    const result = await mesh.settle(call(() => Effect.fail("link closed" as const)));

    expect(result).toEqual({ error: "link closed" });
  });
});
