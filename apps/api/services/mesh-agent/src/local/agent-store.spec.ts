import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openAgentStore } from "./agent-store";

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-store-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("agent store", () => {
  it("generates the node's identity on first boot and gives the same one ever after", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    const created = await run(first.identity());
    await run(first.close());

    const second = await openAgentStore(dir);

    expect(created.nodeId).toMatch(/^node-[0-9a-f-]{36}$/);
    expect(await run(second.identity())).toEqual(created);
    await run(second.close());
  });

  it("gives two nodes two different identities", async () => {
    const a = await openAgentStore(freshDir());
    const b = await openAgentStore(freshDir());

    expect((await run(a.identity())).nodeId).not.toBe((await run(b.identity())).nodeId);
  });

  it("starts with a standalone credential of its own, outside any swarm, and keeps it", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    const credential = await run(first.credential());
    await run(first.close());

    expect(credential.swarmId).toBeNull();
    expect(credential.secret.length).toBeGreaterThanOrEqual(40);
    expect(await run((await openAgentStore(dir)).credential())).toEqual(credential);
  });

  it("replaces the credential when a swarm's is installed, and keeps that across restarts", async () => {
    const dir = freshDir();
    const store = await openAgentStore(dir);
    await run(store.credential());

    await run(store.installCredential("the-swarm-secret", "swarm-1"));
    await run(store.close());

    expect(await run((await openAgentStore(dir)).credential())).toMatchObject({ secret: "the-swarm-secret", swarmId: "swarm-1" });
  });

  it("remembers the seeds it was given, once each, in the order it got them", async () => {
    const dir = freshDir();
    const store = await openAgentStore(dir);

    await run(store.addSeed("ws://b"));
    await run(store.addSeed("ws://c"));
    await run(store.addSeed("ws://b"));
    await run(store.close());

    expect(await run((await openAgentStore(dir)).seeds())).toEqual(["ws://b", "ws://c"]);
  });

  it("applies its schema steps once, so reopening a migrated file changes nothing", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    await run(first.identity());
    await run(first.close());

    const reopened = await openAgentStore(dir);

    expect(await run(reopened.seeds())).toEqual([]);
    await run(reopened.close());
  });

  it("fails with a typed error when the store cannot be written", async () => {
    const store = await openAgentStore(freshDir());
    await run(store.close());

    const error = await run(store.identity().pipe(Effect.flip));

    expect(error).toMatchObject({ _tag: "AgentStoreError", operation: "identity" });
  });
});
