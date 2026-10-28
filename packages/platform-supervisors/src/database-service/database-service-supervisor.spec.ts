import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerNotFound, type DockerEngineShape } from "@deployer/docker";

import { instanceAlias } from "./database-instance";
import { makeDatabaseServiceSupervisor, type DatabaseServiceConfig } from "./database-service-supervisor";

type Spec = { name: string; env: string[]; mounts: { source: string }[]; networks: { aliases: string[] }[]; labels: Record<string, string> };

function setup(instances: string[], options: { swarmActive?: boolean; failFor?: string; tasks?: Record<string, number> } = {}) {
	let wanted = instances;
	const services = new Map<string, { ID: string; CreatedAt: string; UpdatedAt: string; Spec: { Name: string } }>();
	const reconciled: Spec[] = [];
	const volumes: string[] = [];
	const removed: string[] = [];
	const ensureOverlay = vi.fn(() => Effect.void);

	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(options.swarmActive ?? true) },
		networks: { ensureOverlay },
		volumes: {
			ensure: (name: string) =>
				Effect.sync(() => {
					volumes.push(name);
				}),
		},
		swarmServices: {
			reconcile: (spec: Spec) =>
				spec.name === options.failFor
					? Effect.fail(new Error("engine refused"))
					: Effect.sync(() => {
							reconciled.push(spec);
							services.set(spec.name, { ID: `svc-${spec.name}`, CreatedAt: "c", UpdatedAt: "u", Spec: { Name: spec.name } });
						}),
			inspect: (name: string) => {
				const found = services.get(name);
				return found === undefined ? Effect.fail(new DockerNotFound({ resource: name })) : Effect.succeed(found);
			},
			listTasks: (name: string) => Effect.succeed(Array.from({ length: options.tasks?.[name] ?? 1 }, () => ({ Status: { State: "running" } }))),
			remove: (name: string) =>
				Effect.sync(() => {
					removed.push(name);
					services.delete(name);
				}),
		},
	} as unknown as DockerEngineShape;

	const config: DatabaseServiceConfig = {
		instances: () => wanted,
		prefix: () => "",
		runtimeOverride: () => undefined,
		settings: () => ({ user: "app", password: "pw", name: "appdb" }),
	};
	const logger = { log: vi.fn() };
	return {
		db: makeDatabaseServiceSupervisor({ engine, config, logger }),
		reconciled,
		volumes,
		removed,
		logger,
		setInstances: (next: string[]) => {
			wanted = next;
		},
	};
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("database service — convergence", () => {
	it("runs one replicated Postgres per instance, each with its own volume and its name as the alias", async () => {
		vi.useFakeTimers();
		const { db, reconciled, volumes } = setup(["db-a", "db-b"]);
		await run(db.spec.converge);
		vi.useRealTimers();
		expect(reconciled.map((spec) => spec.name).sort()).toEqual(["deployer-database-db-a", "deployer-database-db-b"]);
		expect(volumes.sort()).toEqual(["deployer-database-data-db-a", "deployer-database-data-db-b"]);
		const first = reconciled.find((spec) => spec.name === "deployer-database-db-a");
		expect(first?.env).toEqual(["POSTGRES_DB=appdb", "POSTGRES_USER=app", "POSTGRES_PASSWORD=pw"]);
		expect(first?.networks[0]?.aliases).toEqual(expect.arrayContaining(["db-a", "deployer-database-db-a"]));
		expect(first?.labels["deployer.database.instance"]).toBe("db-a");
	});

	it("keeps converging the other instances when one fails, and reports that one unhealthy", async () => {
		vi.useFakeTimers();
		const { db, reconciled } = setup(["db-a", "db-b"], { failFor: "deployer-database-db-a" });
		const done = run(db.spec.converge);
		await vi.advanceTimersByTimeAsync(10_000);
		await done;
		vi.useRealTimers();
		expect(reconciled.map((spec) => spec.name)).toEqual(["deployer-database-db-b"]);
		const probe = await run(db.spec.probe);
		expect(probe.healthy).toBe(false);
		expect(probe.detail).toBe("one or more database instances not running");
	});

	it("scales down by removing the service of an instance that is no longer wanted", async () => {
		const { db, removed, logger, setInstances } = setup(["db-a", "db-b"]);
		await run(db.spec.converge);
		setInstances(["db-a"]);
		await run(db.spec.converge);
		expect(removed).toEqual(["deployer-database-db-b"]);
		expect(logger.log).toHaveBeenCalledWith("Database instance 'db-b' scaled down — removing");
		expect((await run(db.spec.probe)).payload.children.map((child) => child.instance)).toEqual(["db-a"]);
	});

	it("scales up by adding the new instance on the next pass", async () => {
		const { db, reconciled, setInstances } = setup(["db-a"]);
		await run(db.spec.converge);
		setInstances(["db-a", "db-b"]);
		await run(db.spec.converge);
		expect(reconciled.map((spec) => spec.name)).toContain("deployer-database-db-b");
	});

	it("does not fail the aggregate when there is no swarm: the instances report their own degraded state", async () => {
		const { db, reconciled } = setup(["db-a"], { swarmActive: false });
		await run(db.spec.converge);
		expect(reconciled).toHaveLength(0);
	});
});

describe("database service — probe and process info", () => {
	it("is healthy only when every instance has a running task, and masks the password", async () => {
		const { db } = setup(["db-a", "db-b"]);
		await run(db.spec.converge);
		const probe = await run(db.spec.probe);
		expect(probe.healthy).toBe(true);
		expect(probe.payload.instances).toEqual(["db-a", "db-b"]);
		expect(probe.payload.children[0]?.urlSafe).toBe("postgresql://app:*****@db-a:5432/appdb");
	});

	it("reports an instance with no running task as not running", async () => {
		const { db } = setup(["db-a", "db-b"], { tasks: { "deployer-database-db-b": 0 } });
		await run(db.spec.converge);
		expect((await run(db.spec.probe)).healthy).toBe(false);
	});

	it("is not healthy before anything converged", async () => {
		const { db } = setup(["db-a"]);
		const probe = await run(db.spec.probe);
		expect(probe.healthy).toBe(false);
		expect(probe.payload.children).toEqual([]);
	});

	it("lists each instance's service and connection in the process info", async () => {
		const { db } = setup(["db-a"]);
		await run(db.spec.converge);
		const info = (await run(db.spec.processInfo)) as { instances: string[]; children: { name: string; process: { live: { exists: boolean } } }[] };
		expect(info.instances).toEqual(["db-a"]);
		expect(info.children[0]).toMatchObject({ name: "deployer-database-db-a", process: { live: { exists: true } } });
	});
});

describe("instanceAlias", () => {
	it("keeps only DNS-safe characters", () => {
		expect(instanceAlias("db a/1!")).toBe("dba1");
		expect(instanceAlias("db-a_1")).toBe("db-a_1");
	});
});
