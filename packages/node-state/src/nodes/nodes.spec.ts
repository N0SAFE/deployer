import { Cause, Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClusterSnapshot } from "@deployer/contracts-entities";
import { LOCAL_MIGRATIONS_DIR } from "@deployer/nest-schema/migrations";

import { makeLocalDatabase } from "../database/local-database";

import { makeClusterNodeInventoryRepository } from "./cluster-node-inventory.repository";
import { makeClusterNodeRepository } from "./cluster-node.repository";
import { toEngineNodeRow } from "./engine-node-row";
import { makeAgentFirstNodeConfigRepository, makeNodeConfigRepository, type NewNodeConfigRow, type NodeConfigRow } from "./node-config.repository";

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const snapshot = (term: number): ClusterSnapshot => ({
	clusterId: "cluster-abc",
	clusterName: null,
	localNodeState: "active",
	controlAvailable: true,
	nodeCount: 3,
	managerCount: 3,
	localNode: {
		nodeId: "n1",
		hostname: "node-1",
		swarmRole: "manager",
		platformRole: "both",
		isMaster: true,
		isIngress: true,
		availability: "active",
		capacity: { nanoCpus: 4_000_000_000, memoryBytes: 8_589_934_592 },
		labels: { "deployer.ingress": "true" },
		lastHeartbeatAt: "2026-09-04T00:00:00Z",
	},
	master: { nodeId: "n1", term, electedAt: "2026-09-04T00:00:00Z", heartbeatAt: "2026-09-04T00:00:00Z", reason: "raft_leader" },
	membership: { nodeId: "n1", state: "active", joinedAt: "2026-09-04T00:00:00Z" },
});

let scope: Scope.Closeable;
let database: Awaited<ReturnType<typeof open>>;

const open = () =>
	run(
		Effect.gen(function* () {
			scope = yield* Scope.make();
			return yield* makeLocalDatabase({ databasePath: ":memory:", migrationsDir: LOCAL_MIGRATIONS_DIR }).pipe(Scope.provide(scope));
		}),
	);

beforeEach(async () => {
	database = await open();
});

afterEach(async () => {
	await run(Scope.close(scope, Exit.void));
});

describe("LocalDatabase", () => {
	it("applies the migrations to a fresh database and records them", () => {
		const tables = database.client.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];

		expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining(["node_config", "cluster_node", "cluster_nodes", "local_migrations"]));
	});

	it("turns a failing query into a LocalDatabaseError naming the operation", async () => {
		await expect(run(database.use("bad query", (db) => { db.run("select * from nope"); }))).rejects.toMatchObject({
			_tag: "LocalDatabaseError",
			operation: "bad query",
		});
	});
});

describe("NodeConfigRepository", () => {
	it("has no config until one is written, then returns what was upserted", async () => {
		const repository = makeNodeConfigRepository(database);
		expect(await run(repository.find())).toBeNull();

		const written = await run(repository.upsert({ nodeId: "n1", strategy: "local", meshUrlsSnapshot: ["http://a"] } as never));

		expect(written.meshUrlsSnapshot).toEqual(["http://a"]);
		expect((await run(repository.find()))?.meshUrlsSnapshot).toEqual(["http://a"]);
	});

	it("merges mesh peers without duplicates, and does nothing before there is a row", async () => {
		const repository = makeNodeConfigRepository(database);
		expect(await run(repository.updateMeshPeers(["http://x"]))).toBeNull();
		await run(repository.upsert({ nodeId: "n1", strategy: "local", meshUrlsSnapshot: ["http://a"] } as never));

		const merged = await run(repository.updateMeshPeers(["http://a", "http://b"]));

		expect(merged?.meshUrlsSnapshot).toEqual(["http://a", "http://b"]);
	});
});

const AGENT_ROW: NodeConfigRow = {
	id: 1,
	nodeId: "agent-node",
	strategy: "local",
	setupState: "setup_done",
	deployerVersion: "1.2.3",
	upgradedAtVersion: null,
	meshUrlsSnapshot: ["http://agent"],
	databaseUrl: "postgres://agent",
	databaseProvisioning: "local",
	configuredAt: "2026-10-30T10:00:00.000Z",
	peerServiceToken: null,
	peerServiceTokenExpiresAt: null,
	updatedAt: "2026-10-30T10:00:00.000Z",
	meshSharedSecret: "agent-secret",
	meshSharedSecretUpdatedAt: null,
	scanConfig: null,
	postSetupFlags: null,
	swarmConfig: null,
};

const localRows = () => database.client.query("SELECT * FROM node_config").all();

describe("AgentFirstNodeConfigRepository", () => {
	it("answers from the agent's record and never touches the local file", async () => {
		const writes: NewNodeConfigRow[] = [];
		const repository = makeAgentFirstNodeConfigRepository(database, {
			read: () => Effect.succeed(AGENT_ROW),
			write: (row) => {
				writes.push(row);
				return Effect.succeed({ ...AGENT_ROW, ...row, id: 1 });
			},
		});

		expect(await run(repository.find())).toEqual(AGENT_ROW);
		expect(await run(repository.getMeshSharedSecret())).toBe("agent-secret");

		const written = await run(repository.upsert({ nodeId: "written", strategy: "local" } as never));

		expect(written.nodeId).toBe("written");
		expect(writes).toHaveLength(1);
		expect(localRows()).toEqual([]);
	});

	it("falls back to the local file when the record store has no answer", async () => {
		await run(makeNodeConfigRepository(database).upsert({ nodeId: "file-node", strategy: "local", updatedAt: "2026-10-30T10:00:00.000Z" }));
		const repository = makeAgentFirstNodeConfigRepository(database, {
			read: () => Effect.succeed(null),
			write: () => Effect.succeed(null),
		});

		expect((await run(repository.find()))?.nodeId).toBe("file-node");
		expect((await run(repository.upsert({ nodeId: "file-2", strategy: "local" } as never))).nodeId).toBe("file-2");
		expect((await run(repository.find()))?.nodeId).toBe("file-2");
	});

	it("merges mesh peers through the record store, deduplicated", async () => {
		const writes: NewNodeConfigRow[] = [];
		const repository = makeAgentFirstNodeConfigRepository(database, {
			read: () => Effect.succeed(AGENT_ROW),
			write: (row) => {
				writes.push(row);
				return Effect.succeed({ ...AGENT_ROW, ...row, id: 1 });
			},
		});

		const merged = await run(repository.updateMeshPeers(["http://agent", "http://new"]));

		expect(merged?.meshUrlsSnapshot).toEqual(["http://agent", "http://new"]);
		expect(writes[0]?.meshUrlsSnapshot).toEqual(["http://agent", "http://new"]);
		expect(localRows()).toEqual([]);
	});
});

describe("ClusterNodeRepository", () => {
	it("stores a snapshot, with the join tokens passed explicitly", async () => {
		const repository = makeClusterNodeRepository(database);

		const row = await run(repository.upsertFromSnapshot(snapshot(4), { worker: "worker-token-1", manager: "manager-token-1" }));

		expect(row).toEqual(expect.objectContaining({ clusterId: "cluster-abc", masterTerm: 4, joinTokenWorker: "worker-token-1" }));
	});

	it("leaves the tokens null when none are passed", async () => {
		const repository = makeClusterNodeRepository(database);

		const row = await run(repository.upsertFromSnapshot(snapshot(4)));

		expect(row.joinTokenWorker).toBeNull();
		expect(row.joinTokenManager).toBeNull();
	});

	it("lets exactly one claimant win a term, and refuses a stale one", async () => {
		const repository = makeClusterNodeRepository(database);
		await run(repository.upsertFromSnapshot(snapshot(4)));

		expect(await run(repository.claimMaster("n2", 4, "failover"))).toBe(true);
		expect(await run(repository.claimMaster("n3", 4, "failover"))).toBe(false);
		expect(await run(repository.find())).toEqual(expect.objectContaining({ masterNodeId: "n2", masterTerm: 5 }));
	});

	it("records election history and refreshes the heartbeat", async () => {
		const repository = makeClusterNodeRepository(database);
		await run(repository.upsertFromSnapshot(snapshot(1)));

		await run(repository.recordMasterHistory("n1", 2, "failover", 120));
		await run(repository.touchMasterHeartbeat());

		const history = database.client.query("SELECT node_id, term FROM cluster_master_history").all();
		expect(history).toEqual([{ node_id: "n1", term: 2 }]);
	});
});

describe("ClusterNodeInventoryRepository", () => {
	const engineNode = (nodeId: string) => ({
		nodeId,
		hostname: `host-${nodeId}`,
		swarmRole: "worker" as const,
		platformRole: "worker" as const,
		isLeader: false,
		isIngress: false,
		availability: "active" as const,
		state: "ready" as const,
		nanoCpus: null,
		memoryBytes: null,
		labels: {},
	});

	it("upserts nodes and marks the ones missing from a sweep as down", async () => {
		const repository = makeClusterNodeInventoryRepository(database);
		await run(repository.upsertFromEngine(engineNode("a")));
		await run(repository.upsertFromEngine(engineNode("b")));

		expect(await run(repository.markMissingNodeDown(["a"]))).toBe(1);

		const states = Object.fromEntries((await run(repository.list())).map((row) => [row.nodeId, row.state]));
		expect(states).toEqual({ a: "active", b: "down" });
	});

	it("is empty, not an error, when listed before the schema exists", async () => {
		database.client.run("DROP TABLE cluster_nodes");

		expect(await run(makeClusterNodeInventoryRepository(database).list())).toEqual([]);
	});
});

describe("toEngineNodeRow", () => {
	const node = (status: string, availability: string) => ({
		ID: "node-1",
		Spec: { Labels: {}, Availability: availability },
		Description: { Hostname: "node-1" },
		Status: { State: status },
		ManagerStatus: null,
	});

	it("surfaces the engine's own ready state", () => {
		expect(toEngineNodeRow(node("ready", "active") as never)).toMatchObject({ state: "ready", availability: "active" });
	});

	it("surfaces an engine-down node instead of assuming it is active", () => {
		expect(toEngineNodeRow(node("down", "active") as never)).toMatchObject({ state: "down" });
		expect(toEngineNodeRow(node("unknown", "active") as never).state).toBe("unknown");
	});

	it("keeps drain availability alongside the engine state", () => {
		expect(toEngineNodeRow(node("ready", "drain") as never)).toMatchObject({ state: "ready", availability: "drain" });
	});

	it("persists a ready node as active and an engine-down node as down", async () => {
		const repository = makeClusterNodeInventoryRepository(database);
		const ready = toEngineNodeRow(node("ready", "active") as never);
		const down = { ...ready, nodeId: "node-2", state: "down" as const };

		await run(repository.upsertFromEngine(ready));
		await run(repository.upsertFromEngine(down));

		const states = Object.fromEntries((await run(repository.list())).map((row) => [row.nodeId, row.state]));
		expect(states).toEqual({ "node-1": "active", "node-2": "down" });
	});
});
