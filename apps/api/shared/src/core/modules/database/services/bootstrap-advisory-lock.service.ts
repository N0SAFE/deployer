import { Inject, Injectable, Logger } from "@nestjs/common";

import { GLOBAL_DATABASE_POOL } from "../database-connection";

import type { OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";


/**
 * A Postgres advisory lock around the boot-time side effects.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Migrations, the default-admin upsert and the supervisor convergence are
 * CONVERGENT but not atomic: two replicas booting at the same moment run the
 * same DDL and the same INSERT, and the loser gets a duplicate-object error
 * (or, worse, both create an admin on a boundary). Drizzle's journal does not
 * serialise them across processes — it only skips files it has SEEN recorded.
 *
 * A `pg_try_advisory_lock` makes "one replica does the boot work, the rest
 * proceed" explicit. The try-variant, not the blocking one: a replica that
 * loses is not wrong to start, and must not hang behind a slow peer.
 *
 * ── WHY A DEDICATED CLIENT ──────────────────────────────────────────────────
 * Advisory locks are SESSION-scoped. `pool.query()` may hand each statement a
 * different connection, so locking through the pool would release the lock the
 * moment that statement ends and unlock from a connection that never held it.
 * The client is therefore taken with `pool.connect()` and kept until release.
 *
 * The key is fixed: it names the BOOT sequence, not a caller, so every replica
 * of every service contends for the same lock on purpose.
 */
@Injectable()
export class BootstrapAdvisoryLockService implements OnModuleDestroy {
	private static readonly CLASS_ID = 0x0001_5eed;
	private static readonly OBJECT_ID = 1;

	private readonly logger = new Logger(BootstrapAdvisoryLockService.name);

	/** The connection holding the lock; `null` when this replica does not hold it. */
	private holder: PoolClient | null = null;

	constructor(@Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool) {}

	/**
	 * Try to take the boot lock.
	 *
	 * @returns `true` when THIS replica now owns the sequence and should run it;
	 *          `false` when another replica holds it (skip, do not wait).
	 */
	async acquire(): Promise<boolean> {
		if (this.holder !== null) return true;

		const client = await this.pool.connect();
		try {
			const { rows } = await client.query<{ locked: boolean }>(
				"SELECT pg_try_advisory_lock($1, $2) AS locked",
				[BootstrapAdvisoryLockService.CLASS_ID, BootstrapAdvisoryLockService.OBJECT_ID],
			);
			if (rows[0]?.locked !== true) {
				client.release();
				return false;
			}
			this.holder = client;
			return true;
		} catch (error: unknown) {
			client.release();
			throw error;
		}
	}

	/** Release the lock (idempotent), returning the connection to the pool. */
	async release(): Promise<void> {
		const client = this.holder;
		if (client === null) return;
		this.holder = null;

		try {
			await client.query("SELECT pg_advisory_unlock($1, $2)", [
				BootstrapAdvisoryLockService.CLASS_ID,
				BootstrapAdvisoryLockService.OBJECT_ID,
			]);
		} catch (error: unknown) {
			// The connection is dropped below either way; a lost unlock cannot be
			// recovered here, and it only lasts for the life of that session.
			this.logger.warn(
				`Advisory lock release failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			client.release();
		}
	}

	/** Teardown safety net: a lock must not outlive the scope that took it. */
	async onModuleDestroy(): Promise<void> {
		await this.release();
	}
}
