import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeLocalDbSupervisor, type LocalSqlite } from "./local-db-supervisor";

/** The port over a real bun:sqlite database: what the Nest host builds over drizzle's `$client`. */
function over(database: Database, ping: Effect.Effect<void, unknown> = Effect.try({ try: () => database.run("SELECT 1"), catch: (cause) => cause }).pipe(Effect.asVoid)): LocalSqlite {
	return {
		ping,
		all: (sql) => Effect.try({ try: () => database.query(sql).all(), catch: (cause) => cause }),
		get: (sql) => Effect.try({ try: () => database.query(sql).get(), catch: (cause) => cause }),
	};
}

function seeded(path = ":memory:"): Database {
	const database = new Database(path);
	database.run("CREATE TABLE node_config (id integer primary key, node_id text not null)");
	database.run("CREATE TABLE local_migrations (id integer primary key, name text not null)");
	database.run("INSERT INTO local_migrations (name) VALUES ('0001'), ('0002')");
	return database;
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("local-db supervisor", () => {
	it("converges by proving the handle is usable", async () => {
		await run(makeLocalDbSupervisor({ sqlite: over(seeded()) }).spec.converge);
	});

	it("fails convergence when the handle is unusable", async () => {
		const broken = over(seeded(), Effect.fail(new Error("database is locked")));
		await expect(run(makeLocalDbSupervisor({ sqlite: broken }).spec.converge)).rejects.toThrow("locked");
	});

	it("reports real measurements: tables, migrations, journal mode and sizes", async () => {
		const probe = await run(makeLocalDbSupervisor({ sqlite: over(seeded()) }).spec.probe);
		expect(probe.healthy).toBe(true);
		expect(probe.payload.tables).toEqual(["local_migrations", "node_config"]);
		expect(probe.payload.tableCount).toBe(2);
		expect(probe.payload.migrationsApplied).toBe(2);
		expect(probe.payload.databaseSizeBytes).toBeGreaterThan(0);
		expect(probe.detail).toContain("2 tables, 2 migrations");
	});

	it("reads the file path and size from disk for a file-backed database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "local-db-"));
		try {
			const path = join(dir, "node.db");
			const database = seeded(path);
			const probe = await run(makeLocalDbSupervisor({ sqlite: over(database) }).spec.probe);
			expect(probe.payload.dbPath).toBe(path);
			expect(probe.payload.fileSizeBytes).toBeGreaterThan(0);
			database.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("is unhealthy with an empty payload when SELECT 1 fails, never failing the probe", async () => {
		const probe = await run(makeLocalDbSupervisor({ sqlite: over(seeded(), Effect.fail(new Error("database is locked"))) }).spec.probe);
		expect(probe).toMatchObject({ healthy: false, payload: { tableCount: 0, dbPath: "unknown", fileSizeBytes: null } });
		expect(probe.detail).toBe("SELECT 1 failed: database is locked");
	});

	it("keeps going when a database has no migrations table", async () => {
		const database = new Database(":memory:");
		database.run("CREATE TABLE node_config (id integer primary key)");
		const probe = await run(makeLocalDbSupervisor({ sqlite: over(database) }).spec.probe);
		expect(probe).toMatchObject({ healthy: true, payload: { migrationsApplied: 0, tables: ["node_config"] } });
	});

	it("reports the sqlite process in the process info", async () => {
		const info = (await run(makeLocalDbSupervisor({ sqlite: over(seeded()) }).spec.processInfo)) as { process: { kind: string; tableCount: number; migrationsApplied: number } };
		expect(info.process).toMatchObject({ kind: "sqlite", tableCount: 2, migrationsApplied: 2 });
	});
});
