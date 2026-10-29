import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createDirectoryStore } from "../directory/directory-store";
import { MeshDirectory, directoryOver } from "../directory/directory.service";

import { type CallOutcome, brokerCall } from "./broker-call";
import { KeyHints, keyHintsOver } from "./key-hints.service";

import type { ReplicaRecord } from "../directory/replica-record";

const NOW = 1_000;

const replica = (replicaId: string, nodeId: string, overrides: Partial<ReplicaRecord> = {}): ReplicaRecord => ({
  service: "project",
  replicaId,
  nodeId,
  address: `http://${replicaId}`,
  load: 0.2,
  keys: [],
  generation: 1,
  expiresAt: NOW + 10_000,
  ...overrides,
});

async function setup(records: ReplicaRecord[]) {
  const directory = directoryOver(createDirectoryStore());
  for (const record of records) {
    await Effect.runPromise(directory.register(record));
  }
  const hints = keyHintsOver(new Map());
  return { directory, hints };
}

function run<A, E>(
  fixture: Awaited<ReturnType<typeof setup>>,
  invoke: (replica: ReplicaRecord) => Effect.Effect<CallOutcome<A>, E>,
  overrides: { key?: string; maxHops?: number } = {},
) {
  return Effect.runPromise(
    brokerCall({
      service: "project",
      key: overrides.key,
      localNode: "A",
      maxHops: overrides.maxHops ?? 3,
      hintTtlMs: 5_000,
      now: () => NOW,
      invoke,
    }).pipe(
      Effect.provideService(MeshDirectory, fixture.directory),
      Effect.provideService(KeyHints, fixture.hints),
      Effect.match({ onSuccess: (value) => ({ value }), onFailure: (error) => ({ error }) }),
    ),
  );
}

const ok = <A>(value: A): CallOutcome<A> => ({ kind: "ok", value });
const redirect = (replicaId: string): CallOutcome<never> => ({ kind: "redirect", replicaId, reason: "holds the deployment" });

describe("brokerCall", () => {
  it("serves the local replica without crossing nodes", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-2", "B")]);
    const invoke = vi.fn((target: ReplicaRecord) => Effect.succeed(ok(target.replicaId)));

    const result = await run(fixture, invoke);

    expect(result).toEqual({ value: "project-1" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("answers a redirect itself and returns the final result to the caller", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-3", "C")]);
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-3") : ok(`served by ${target.replicaId}`)),
    );

    const result = await run(fixture, invoke);

    expect(result).toEqual({ value: "served by project-3" });
    expect(invoke.mock.calls.map(([target]) => target.replicaId)).toEqual(["project-1", "project-3"]);
  });

  it("remembers the replica that served a key so the next call skips the detour", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-3", "C")]);
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-3") : ok(target.replicaId)),
    );

    await run(fixture, invoke, { key: "deploy-7" });
    invoke.mockClear();
    const second = await run(fixture, invoke, { key: "deploy-7" });

    expect(second).toEqual({ value: "project-3" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("stops at the hop limit when replicas keep redirecting", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-2", "B"), replica("project-3", "C")]);
    const next: Record<string, string> = { "project-1": "project-2", "project-2": "project-3", "project-3": "project-1" };

    const result = await run(fixture, (target) => Effect.succeed(redirect(next[target.replicaId] ?? "project-1")), {
      maxHops: 1,
    });

    expect(result).toMatchObject({ error: { _tag: "MeshRedirectExhausted", hops: 2 } });
  });

  it("does not loop back to a replica it already tried", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-2", "B")]);
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-2") : redirect("project-1")),
    );

    const result = await run(fixture, invoke);

    expect(result).toMatchObject({ error: { _tag: "MeshRedirectExhausted" } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("resolves again when the redirect names a replica the directory no longer knows", async () => {
    const fixture = await setup([replica("project-1", "A"), replica("project-2", "B")]);
    const invoke = vi.fn((target: ReplicaRecord) =>
      Effect.succeed(target.replicaId === "project-1" ? redirect("project-9") : ok(target.replicaId)),
    );

    const result = await run(fixture, invoke);

    expect(result).toEqual({ value: "project-2" });
  });

  it("fails when no replica of the service is known", async () => {
    const fixture = await setup([]);

    const result = await run(fixture, (target) => Effect.succeed(ok(target.replicaId)));

    expect(result).toMatchObject({ error: { _tag: "MeshNoReplica", service: "project" } });
  });

  it("passes the transport failure of an attempt through unchanged", async () => {
    const fixture = await setup([replica("project-1", "A")]);

    const result = await run(fixture, () => Effect.fail("link closed" as const));

    expect(result).toEqual({ error: "link closed" });
  });
});
