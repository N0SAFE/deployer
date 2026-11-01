import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openAgentStore } from "./agent-store";
import { openSqlite } from "./sqlite";

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

  it("reopens the store in WAL with a busy timeout, and keeps its file owner-only", async () => {
    const dir = freshDir();
    await run((await openAgentStore(dir)).close());
    // The second open is a reopen of the same file: the pragmas are re-applied, and WAL is a property of the database.
    await run((await openAgentStore(dir)).close());

    const handle = await openSqlite(join(dir, "agent.db"));
    expect(handle.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(handle.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    handle.close();

    expect(statSync(join(dir, "agent.db")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
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

describe("agent store credential rotation", () => {
  it("keeps the secret a rotation replaces, with its expiry, across a reopen", async () => {
    const dir = freshDir();
    const store = await openAgentStore(dir);
    await run(store.installCredential("swarm-secret", "swarm-1"));

    await run(store.rotateCredential("next-secret", 2_000));
    await run(store.close());

    const reopened = await openAgentStore(dir);
    expect(await run(reopened.credential())).toMatchObject({
      secret: "next-secret",
      swarmId: "swarm-1",
      previousSecret: "swarm-secret",
      previousValidUntil: 2_000,
    });
    await run(reopened.close());
  });

  it("clears the rotation when the node joins a swarm, because a join is a new membership", async () => {
    const store = await openAgentStore(freshDir());
    await run(store.credential());
    await run(store.rotateCredential("next-secret", 2_000));

    await run(store.installCredential("joined-secret", "swarm-2"));

    expect(await run(store.credential())).toMatchObject({
      secret: "joined-secret",
      previousSecret: null,
      previousValidUntil: null,
    });
    await run(store.close());
  });
});

describe("agent store settings", () => {
	it("keeps a roster setting by key, and updates it in place", async () => {
		const store = await openAgentStore(freshDir());

		expect(await run(store.setting("node.doors"))).toBeUndefined();

		await run(store.putSetting("node.doors", '{"a":1}'));
		expect(await run(store.setting("node.doors"))).toBe('{"a":1}');

		await run(store.putSetting("node.doors", '{"a":2}'));
		expect(await run(store.setting("node.doors"))).toBe('{"a":2}');
		await run(store.close());
	});
});

describe("agent store setting stamps", () => {
	it("lists settings with their stamps and keeps one written out of order", async () => {
		const store = await openAgentStore(freshDir());

		await run(store.putSetting("b", "2", 20));
		await run(store.putSetting("a", "1", 10));

		expect(await run(store.settings())).toEqual([
			{ key: "a", value: "1", updatedAt: 10 },
			{ key: "b", value: "2", updatedAt: 20 },
		]);
		await run(store.close());
	});
});

describe("agent store revoked tokens", () => {
	it("remembers a revoked token, idempotently", async () => {
		const store = await openAgentStore(freshDir());

		expect(await run(store.isTokenRevoked("token-a"))).toBe(false);
		await run(store.revokeToken("token-a"));
		await run(store.revokeToken("token-a"));
		expect(await run(store.isTokenRevoked("token-a"))).toBe(true);
		expect(await run(store.isTokenRevoked("token-b"))).toBe(false);
		await run(store.close());
	});
});

describe("agent store identity seeding", () => {
  it("uses a seed only for a node that does not exist yet, then the store wins", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    const seeded = await run(first.identity("node-dev-pin"));
    await run(first.close());

    const second = await openAgentStore(dir);
    const unseeded = await run(second.identity("node-another-pin"));

    expect(seeded.nodeId).toBe("node-dev-pin");
    expect(unseeded.nodeId).toBe("node-dev-pin");
    await run(second.close());
  });
});

describe("agent store secrets", () => {
  it("has no secret until one is written", async () => {
    const store = await openAgentStore(freshDir());

    expect(await run(store.secret("overlay.self"))).toBeUndefined();
    await run(store.close());
  });

  it("keeps a secret by name, and overwrites it in place", async () => {
    const store = await openAgentStore(freshDir());

    await run(store.putSecret("overlay.self", "first"));
    expect(await run(store.secret("overlay.self"))).toBe("first");

    await run(store.putSecret("overlay.self", "second"));
    expect(await run(store.secret("overlay.self"))).toBe("second");
    await run(store.close());
  });

  it("keeps a secret across a reopen", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    await run(first.putSecret("wireguard.private-key", "the-key"));
    await run(first.close());

    const second = await openAgentStore(dir);
    expect(await run(second.secret("wireguard.private-key"))).toBe("the-key");
    await run(second.close());
  });
});

describe("agent store blocked nodes", () => {
	it("blocks a node once, lists the blocklist in order, and lifts it", async () => {
		const store = await openAgentStore(freshDir());

		expect(await run(store.blockedNodes())).toEqual([]);

		await run(store.blockNode("B"));
		await run(store.blockNode("B"));
		await run(store.blockNode("A"));
		expect(await run(store.blockedNodes())).toEqual(["A", "B"]);

		await run(store.unblockNode("B"));
		await run(store.unblockNode("missing"));
		expect(await run(store.blockedNodes())).toEqual(["A"]);
		await run(store.close());
	});

	it("keeps the blocklist across a reopen, so a revoked node stays revoked after a restart", async () => {
		const dir = freshDir();
		const first = await openAgentStore(dir);
		await run(first.blockNode("B"));
		await run(first.close());

		const second = await openAgentStore(dir);
		expect(await run(second.blockedNodes())).toEqual(["B"]);
		await run(second.close());
	});
});

describe("agent store node config", () => {
  it("has no config until one is written, and keeps it across a reopen", async () => {
    const dir = freshDir();
    const first = await openAgentStore(dir);
    expect(await run(first.nodeConfig())).toBeNull();

    await run(first.putNodeConfig('{"strategy":"local"}', 1_000));
    await run(first.close());

    const second = await openAgentStore(dir);
    expect(await run(second.nodeConfig())).toEqual({ config: '{"strategy":"local"}', updatedAt: 1_000 });
    await run(second.close());
  });
});
