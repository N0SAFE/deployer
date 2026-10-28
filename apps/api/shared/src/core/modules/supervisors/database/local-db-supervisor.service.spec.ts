import { describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import {
	LocalDbSupervisorService,
	LOCAL_DB_SUPERVISOR_ID,
} from "./local-db-supervisor.service";
import { SupervisorOrchestratorService } from "@deployer/nest-effect/supervision";
import type { LocalDb } from "@deployer/node-state";
import type { EnvService } from "../../../../config/env/env.module";

/** In-memory sqlite database wrapped by drizzle — no file I/O in tests. */
function makeInMemoryDb(): LocalDb {
	const sqlite = new Database(":memory:");
	sqlite.run("CREATE TABLE node_config (id integer primary key, node_id text not null)");
	sqlite.run("CREATE TABLE local_migrations (id integer primary key, name text not null)");
	sqlite.run("INSERT INTO local_migrations (name) VALUES ('0001'), ('0002')");
	return drizzle(sqlite);
}

function makeSupervisor(db: LocalDb): LocalDbSupervisorService {
	const env = {
		get: vi.fn((key: string) => {
			const values: Record<string, unknown> = {
				MANAGED_LOCAL_DB_ENABLED: false,
			};
			return values[key];
		}),
	} as unknown as EnvService;
	return new LocalDbSupervisorService(db, env);
}

describe("LocalDbSupervisorService", () => {
	it("registers with the orchestrator unless the deployment owns the file", () => {
		const registered = makeSupervisor(makeInMemoryDb());
		const orchestrator = new SupervisorOrchestratorService();
		(registered as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;
		registered.onModuleInit();
		expect(orchestrator.has(LOCAL_DB_SUPERVISOR_ID)).toBe(true);

		const composeOwned = new LocalDbSupervisorService(makeInMemoryDb(), {
			get: vi.fn((key: string) => (key === "MANAGED_LOCAL_DB_ENABLED" ? true : undefined)),
		} as unknown as EnvService);
		const other = new SupervisorOrchestratorService();
		(composeOwned as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = other;
		composeOwned.onModuleInit();
		expect(other.has(LOCAL_DB_SUPERVISOR_ID)).toBe(false);
	});

	it("exposes a stable identity + schema for registry + health reporting", () => {
		const supervisor = makeSupervisor(makeInMemoryDb());
		expect(supervisor.supervisorId).toBe(LOCAL_DB_SUPERVISOR_ID);
		expect(supervisor.payloadSchema).toBeDefined();
	});

	it("converges by proving the sqlite handle is usable", async () => {
		const supervisor = makeSupervisor(makeInMemoryDb());
		const state = await supervisor.ensureDesiredState();
		expect(state).toBe("converged");
	});

	it("reports healthy with real measurements (tables, migrations, journal, sizes)", async () => {
		const supervisor = makeSupervisor(makeInMemoryDb());
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		expect(health.supervisorId).toBe(LOCAL_DB_SUPERVISOR_ID);
		expect(health.healthy).toBe(true);
		expect(health.state).toBe("converged");
		// Discriminated payload — all measurements present.
		expect(health.payload.tableCount).toBeGreaterThanOrEqual(2);
		expect(health.payload.tables).toContain("node_config");
		expect(health.payload.migrationsApplied).toBe(2);
		// In-memory databases report a path + journal + sizes.
		expect(health.payload.dbPath.length).toBeGreaterThan(0);
		expect(health.payload.databaseSizeBytes).toBeGreaterThan(0);
	});

	it("reports unhealthy when SELECT 1 fails (engine unusable)", async () => {
		const db = makeInMemoryDb();
		const supervisor = makeSupervisor(db);
		// Force the liveness query to throw.
		db.run = vi.fn(() => {
			throw new Error("database is locked");
		});

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("locked");
		expect(health.payload.tableCount).toBe(0);
	});
});