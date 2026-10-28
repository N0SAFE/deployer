import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeDatabaseHandle } from "./database-handle";
import { DatabaseNotInitialized, DatabaseUnhealthy } from "./errors";

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
	const exit = await Effect.runPromiseExit(effect);
	return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
};

describe("DatabaseHandle", () => {
	it("fails with DatabaseNotInitialized naming its owner before a connection exists", async () => {
		const handle = makeDatabaseHandle("GlobalDatabase");
		expect(await Effect.runPromise(handle.isInitialized)).toBe(false);
		const failure = await failureOf(handle.db);
		expect(failure).toBeInstanceOf(DatabaseNotInitialized);
		expect((failure as DatabaseNotInitialized).publicMessage()).toBe("GlobalDatabase has not been initialized yet");
	});

	it("hands back the connection once set", async () => {
		const handle = makeDatabaseHandle("X");
		const connection = { run: vi.fn() } as unknown as BunSQLiteDatabase;
		await Effect.runPromise(handle.init(connection));
		expect(await Effect.runPromise(handle.db)).toBe(connection);
		expect(handle.dbNow()).toBe(connection);
	});

	it("probes a bun:sqlite style handle with `run`", async () => {
		const run = vi.fn();
		const handle = makeDatabaseHandle("L", { run } as never);
		expect(await Effect.runPromise(handle.healthy)).toBe(true);
		expect(run).toHaveBeenCalledWith("SELECT 1");
	});

	it("AWAITS a Postgres style `execute`, so an asynchronous failure is unhealthy", async () => {
		const handle = makeDatabaseHandle("G", { execute: () => Promise.reject(new Error("connection refused")) } as never);
		expect(await Effect.runPromise(handle.healthy)).toBe(false);
		const failure = await failureOf(handle.probe);
		expect(failure).toBeInstanceOf(DatabaseUnhealthy);
		expect((failure as DatabaseUnhealthy).reason).toContain("connection refused");
	});

	it("reports unhealthy for an unsupported handle and for no handle", async () => {
		expect(await Effect.runPromise(makeDatabaseHandle("A", {} as never).healthy)).toBe(false);
		expect(await Effect.runPromise(makeDatabaseHandle("B").healthy)).toBe(false);
	});
});
