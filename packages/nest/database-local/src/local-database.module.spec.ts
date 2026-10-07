import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Logger } from "@nestjs/common";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import type { Database as BunSqliteDatabase } from "bun:sqlite";

import { LOCAL_DATABASE_CLIENT } from "@repo/nest-database-core/database-connection";

import { LocalDatabaseModule } from "./local-database.module";
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Spied rather than read from stdout: Nest's `ConsoleLogger` BUFFERS log output
 * until an application attaches its logger, so a skipped-with-warning path
 * prints nothing at all under `Test.createTestingModule()` — the absence would
 * be indistinguishable from the warning never firing.
 */
function captureWarnings(): string[] {
    const messages: string[] = [];
    vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
        messages.push(String(message));
    });
    return messages;
}

afterEach(() => {
    vi.restoreAllMocks();
});

/** Table names present in a SQLite handle. */
function tables(sqlite: BunSqliteDatabase): string[] {
    return (
        sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
            name: string;
        }[]
    ).map((row) => row.name);
}

/**
 * The two migration outcomes the module supports.
 *
 * `:memory:` is used throughout because it is the one path the module treats as
 * per-connection (it cannot be deduplicated against the other Nest contexts in
 * this process), so each test gets a fresh database regardless of test order.
 *
 * `init()` IS REQUIRED AND IS THE POINT: migrations now run from
 * `onModuleInit`, and `compile()` only resolves the graph. A test that stopped
 * at `compile()` would pass without ever exercising the code under test — the
 * exact blind spot this suite exists to close.
 */
describe("LocalDatabaseModule migrations", () => {
    it("skips migrations when no migrationsDir is provided", async () => {
        const warnings = captureWarnings();

        const module: TestingModule = await Test.createTestingModule({
            imports: [LocalDatabaseModule.forRoot({ databasePath: ":memory:" })],
        }).compile();
        await module.init();

        const sqlite = module.get<BunSqliteDatabase>(LOCAL_DATABASE_CLIENT);
        // No migration ran — the app owns the schema and said so by passing no
        // directory, so nothing was created (not even the migration state).
        expect(tables(sqlite)).toEqual([]);
        // Skipped LOUDLY: the absence of a migrations dir is a supported choice,
        // and the warning is what tells an operator the schema was left alone.
        expect(
            warnings.some((message) => message.includes("local schema migrations are SKIPPED")),
        ).toBe(true);

        await module.close();
    });

    it("applies the migrations directory at onModuleInit", async () => {
        const migrationsDir = mkdtempSync(join(tmpdir(), "local-migrations-"));
        writeFileSync(
            join(migrationsDir, "0000_create_widget.sql"),
            [
                "CREATE TABLE widget (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
                "--> statement-breakpoint",
                "CREATE TABLE gadget (id INTEGER PRIMARY KEY);",
            ].join("\n"),
        );

        try {
            const module: TestingModule = await Test.createTestingModule({
                imports: [LocalDatabaseModule.forRoot({ databasePath: ":memory:", migrationsDir })],
            }).compile();
            await module.init();

            const sqlite = module.get<BunSqliteDatabase>(LOCAL_DATABASE_CLIENT);
            // Both statements of the file ran, in ONE migration.
            expect(tables(sqlite)).toContain("widget");
            expect(tables(sqlite)).toContain("gadget");

            const applied = sqlite
                .query("SELECT name FROM local_migrations")
                .all() as { name: string }[];
            expect(applied.map((row) => row.name)).toEqual(["0000_create_widget.sql"]);

            await module.close();
        } finally {
            rmSync(migrationsDir, { recursive: true, force: true });
        }
    });
});