import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import { splitManagedEnv } from "@deployer/env";
import type { LocalDb } from "@deployer/node-state";
import {
	LOCAL_DB_SUPERVISOR_ID,
	
	
	makeLocalDbSupervisor,
	
	type LocalSqlite,
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

import type { Database as BunSqliteDatabase } from "bun:sqlite";

export { LOCAL_DB_SUPERVISOR_ID };

export type LocalDbSupervisorDeps = {
	readonly db: LocalDb;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

/** The supervisor of the node's own SQLite file; registers unless the deployment owns the file. */
export function makeLocalDbRegistration({ db, env, bus }: LocalDbSupervisorDeps): SupervisorRegistration {
	const logger = new Logger("LocalDbSupervisor");
	// Drizzle's bun-sqlite driver exposes the underlying `bun:sqlite` Database as `$client`: the raw
	// handle for inventory and pragmas.
	const client = () => (db as LocalDb & { $client: BunSqliteDatabase }).$client;
	const sqlite: LocalSqlite = {
		// The driver's own error travels as the failure, so its message reaches the health detail.
		ping: Effect.try({ try: () => { db.run("SELECT 1"); }, catch: (cause) => cause }).pipe(Effect.asVoid),
		all: (sql) => Effect.try({ try: () => client().query(sql).all(), catch: (cause) => cause }),
		get: (sql) => Effect.try({ try: () => client().query(sql).get(), catch: (cause) => cause }),
	};
	const localDb = makeLocalDbSupervisor({ sqlite });
	return {
		supervisor: buildSupervisor(localDb.spec, bus, "LocalDbSupervisor"),
		activate: Effect.sync(() => {
			if (splitManagedEnv(env).localDb.enabled) {
				logger.log("Compose-managed local DB detected (MANAGED_LOCAL_DB_ENABLED=true) — supervisor skipped");
				return null;
			}
			return {};
		}),
	};
}
