import { Context, Effect } from "effect";

import type { ServiceLifecycleShape } from "@deployer/nest-effect";

import { AdvisoryLockFailed } from "../database.errors";

import type { Pool, PoolClient } from "pg";

export type BootstrapAdvisoryLockServiceShape = ServiceLifecycleShape & {
	/**
	 * Try to take the boot lock. `true` when THIS replica now owns the sequence and should run it; `false` when another
	 * replica holds it (skip, do not wait).
	 */
	readonly acquire: () => Effect.Effect<boolean, AdvisoryLockFailed>;
	/** Release the lock (idempotent), returning the connection to the pool. Never fails. */
	readonly release: () => Effect.Effect<void>;
};

const CLASS_ID = 0x0001_5eed;
const OBJECT_ID = 1;

/**
 * A Postgres advisory lock around the boot-time side effects.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Migrations, the default-admin upsert and the supervisor convergence are CONVERGENT but not atomic: two replicas booting
 * at the same moment run the same DDL and the same INSERT, and the loser gets a duplicate-object error (or, worse, both
 * create an admin on a boundary). Drizzle's journal does not serialise them across processes.
 *
 * A `pg_try_advisory_lock` makes "one replica does the boot work, the rest proceed" explicit. The try-variant, not the
 * blocking one: a replica that loses is not wrong to start, and must not hang behind a slow peer.
 *
 * ── WHY A DEDICATED CLIENT ──────────────────────────────────────────────────
 * Advisory locks are SESSION-scoped. `pool.query()` may hand each statement a different connection, so locking through the
 * pool would release the lock the moment that statement ends. The client is therefore taken with `pool.connect()` and kept
 * until release. The key is fixed: it names the BOOT sequence, not a caller, so every replica contends on purpose.
 */
export function makeBootstrapAdvisoryLockService(pool: Pool): BootstrapAdvisoryLockServiceShape {
	/** The connection holding the lock; `null` when this replica does not hold it. */
	let holder: PoolClient | null = null;

	const release: BootstrapAdvisoryLockServiceShape["release"] = () =>
		Effect.gen(function* () {
			const client = holder;
			if (client === null) return;
			holder = null;

			// The connection is dropped below either way; a lost unlock cannot be recovered here, and it only lasts for the
			// life of that session.
			yield* Effect.tryPromise(() => client.query("SELECT pg_advisory_unlock($1, $2)", [CLASS_ID, OBJECT_ID])).pipe(
				Effect.catch((error: unknown) =>
					Effect.logWarning(`Advisory lock release failed: ${error instanceof Error ? error.message : String(error)}`),
				),
				Effect.ensuring(Effect.sync(() => { client.release(); })),
			);
		});

	return {
		acquire: () =>
			Effect.gen(function* () {
				if (holder !== null) return true;

				const client = yield* Effect.tryPromise({ try: () => pool.connect(), catch: (cause) => new AdvisoryLockFailed({ cause }) });
				const locked = yield* Effect.tryPromise({
					try: () => client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS locked", [CLASS_ID, OBJECT_ID]),
					catch: (cause) => new AdvisoryLockFailed({ cause }),
				}).pipe(Effect.tapError(() => Effect.sync(() => { client.release(); })));

				if (locked.rows[0]?.locked !== true) {
					client.release();
					return false;
				}
				holder = client;
				return true;
			}),
		release,
		// Teardown safety net: a lock must not outlive the scope that took it.
		onStop: () => release(),
	};
}

export class BootstrapAdvisoryLockService extends Context.Service<BootstrapAdvisoryLockService, BootstrapAdvisoryLockServiceShape>()(
	"shared/BootstrapAdvisoryLockService",
) {}
