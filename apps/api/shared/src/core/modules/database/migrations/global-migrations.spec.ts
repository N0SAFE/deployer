import { describe, expect, it, vi } from "vitest";

import { applyGlobalMigrations, MigrationFailedError } from "./global-migrations";

import type { GlobalDatabase } from "../global/global-database.service";

const db = {} as GlobalDatabase;
const migrationsFolder = "/tmp/migrations";

/** A `pg`-shaped driver error: the SQLSTATE is the only structured field. */
function driverError(code: string, message: string) {
	return Object.assign(new Error(message), { code });
}

describe("applyGlobalMigrations", () => {
	it("reports a clean run as applied", async () => {
		const migrate = vi.fn(() => Promise.resolve(undefined));

		await expect(applyGlobalMigrations(db, { migrationsFolder, migrate })).resolves.toBe(
			"applied",
		);
		expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder });
	});

	it("treats a duplicate-object SQLSTATE as already applied", async () => {
		const migrate = vi.fn(() => Promise.reject(driverError("42P07", 'relation "users" already exists')));

		// The MESSAGE says "already exists", but the decision is the code; a message
		// that says something else would give the same answer.
		await expect(applyGlobalMigrations(db, { migrationsFolder, migrate })).resolves.toBe(
			"already-applied",
		);
	});

	it("throws MigrationFailedError on a real failure", async () => {
		const migrate = vi.fn(() => Promise.reject(driverError("42P01", 'relation "missing_table" does not exist')));

		const failure = await applyGlobalMigrations(db, { migrationsFolder, migrate }).catch(
			(error: unknown) => error,
		);

		expect(failure).toBeInstanceOf(MigrationFailedError);
		expect((failure as MigrationFailedError).sqlState).toBe("42P01");
	});

	it("throws MigrationFailedError when the error carries no SQLSTATE", async () => {
		const migrate = vi.fn(() => Promise.reject(new Error("socket hang up")));

		const failure = await applyGlobalMigrations(db, { migrationsFolder, migrate }).catch(
			(error: unknown) => error,
		);

		expect(failure).toBeInstanceOf(MigrationFailedError);
		expect((failure as MigrationFailedError).sqlState).toBeNull();
	});
});
