import { describe, expect, it, vi } from "vitest";

import { BootstrapAdvisoryLockService } from "./bootstrap-advisory-lock.service";

import type { Pool, PoolClient } from "pg";


/** A pool whose single connection answers `locked` for the try-lock. */
function fakePool(locked: boolean) {
	const client = {
		query: vi.fn((sql: string) =>
			Promise.resolve(sql.includes("pg_try_advisory_lock") ? { rows: [{ locked }] } : { rows: [] }),
		),
		release: vi.fn(),
	};
	const pool = { connect: vi.fn(() => Promise.resolve(client)) };
	return { pool, client, service: new BootstrapAdvisoryLockService(pool as unknown as Pool) };
}

describe("BootstrapAdvisoryLockService", () => {
	it("acquires the lock on a dedicated session connection", async () => {
		const { pool, client, service } = fakePool(true);

		await expect(service.acquire()).resolves.toBe(true);

		expect(pool.connect).toHaveBeenCalledTimes(1);
		// Session-scoped lock: it must be a bigint-free two-int key, held on the
		// connection that will release it — never a pooled one-shot query.
		expect(client.query).toHaveBeenCalledWith(
			expect.stringContaining("pg_try_advisory_lock($1, $2)"),
			[expect.any(Number), expect.any(Number)],
		);

		// Already held: a second acquire is a no-op, not a second connection.
		await expect(service.acquire()).resolves.toBe(true);
		expect(pool.connect).toHaveBeenCalledTimes(1);
	});

	it("skips when another replica holds the lock", async () => {
		const { client, service } = fakePool(false);

		await expect(service.acquire()).resolves.toBe(false);

		// The connection is handed back immediately; nothing is held.
		expect(client.release).toHaveBeenCalledTimes(1);
		await service.release();
		expect(client.query).not.toHaveBeenCalledWith(
			expect.stringContaining("pg_advisory_unlock"),
			expect.anything(),
		);
	});

	it("releases the same connection it locked", async () => {
		const { client, service } = fakePool(true);

		await service.acquire();
		await service.release();

		expect(client.query).toHaveBeenLastCalledWith(
			expect.stringContaining("pg_advisory_unlock($1, $2)"),
			[expect.any(Number), expect.any(Number)],
		);
		expect(client.release).toHaveBeenCalledTimes(1);

		// Idempotent: a second release must not unlock a connection that is gone.
		await service.release();
		expect(client.release).toHaveBeenCalledTimes(1);
	});

	it("releases on scope teardown", async () => {
		const { client, service } = fakePool(true);

		await service.acquire();
		await service.onModuleDestroy();

		expect(client.query).toHaveBeenCalledWith(
			expect.stringContaining("pg_advisory_unlock"),
			expect.anything(),
		);
		expect(client.release).toHaveBeenCalledTimes(1);
	});

	it("hands the connection back when the lock query itself fails", async () => {
		const client = { query: vi.fn(() => Promise.reject(new Error("boom"))), release: vi.fn() };
		const pool = { connect: vi.fn(() => Promise.resolve(client)) };
		const service = new BootstrapAdvisoryLockService(pool as unknown as Pool);

		await expect(service.acquire()).rejects.toThrow("boom");
		expect((client as unknown as PoolClient).release).toHaveBeenCalledTimes(1);
	});
});
