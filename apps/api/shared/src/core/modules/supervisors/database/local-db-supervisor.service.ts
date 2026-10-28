import { Inject, Injectable } from "@nestjs/common";
import type { Database as BunSqliteDatabase } from "bun:sqlite";
import { LOCAL_DATABASE_CONNECTION } from "../../database/database-connection"
import { SupervisorHost } from "@deployer/nest-effect/supervision";
import { splitManagedEnv } from "@deployer/env";
import type { LocalDb } from "@deployer/node-state";
import {
	LOCAL_DB_SUPERVISOR_ID,
	localDbProcessInfoSchema,
	localDbSupervisorPayloadSchema,
	makeLocalDbSupervisor,
	type LocalDbSupervisor,
	type LocalSqlite,
} from "@deployer/platform-supervisors";
import { Effect } from "effect";

import { EnvService } from "../../../../config/env/env.module";

export { LOCAL_DB_SUPERVISOR_ID };

/**
 * The Nest host of the local SQLite supervisor. What it does (prove the handle usable, measure the
 * file: tables, migrations, journal mode, sizes) is `@deployer/platform-supervisors`; this class hands
 * it the database through a small read port and decides WHETHER to register: when the deployment owns
 * the file (`MANAGED_LOCAL_DB_ENABLED=true`, the dev compose volume) the API only probes elsewhere and
 * this supervisor is skipped.
 */
@Injectable()
export class LocalDbSupervisorService extends SupervisorHost<
	typeof localDbSupervisorPayloadSchema,
	typeof localDbProcessInfoSchema
> {
	static readonly identifier = LOCAL_DB_SUPERVISOR_ID;

	readonly payloadSchema = localDbSupervisorPayloadSchema;
	readonly processInfoSchema = localDbProcessInfoSchema;
	readonly description: string;

	private readonly localDb: LocalDbSupervisor;

	constructor(
		@Inject(LOCAL_DATABASE_CONNECTION) db: LocalDb,
		private readonly env: EnvService,
	) {
		super();
		// Drizzle's bun-sqlite driver exposes the underlying `bun:sqlite` Database as `$client`: the raw
		// handle for inventory and pragmas.
		const client = () => (db as LocalDb & { $client: BunSqliteDatabase }).$client;
		const sqlite: LocalSqlite = {
			// The driver's own error travels as the failure, so its message reaches the health detail.
			ping: Effect.try({ try: () => db.run("SELECT 1"), catch: (cause) => cause }).pipe(Effect.asVoid),
			all: (sql) => Effect.try({ try: () => client().query(sql).all(), catch: (cause) => cause }),
			get: (sql) => Effect.try({ try: () => client().query(sql).get(), catch: (cause) => cause }),
		};
		this.localDb = makeLocalDbSupervisor({ sqlite });
		this.description = this.localDb.spec.description;
	}

	protected buildSpec(): LocalDbSupervisor["spec"] {
		return this.localDb.spec;
	}

	override onModuleInit(): void {
		if (splitManagedEnv(this.env).localDb.enabled) {
			this.logger.log("Compose-managed local DB detected (MANAGED_LOCAL_DB_ENABLED=true) — supervisor skipped");
			return;
		}
		super.onModuleInit();
	}
}
