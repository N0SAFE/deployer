/**
 * LocalDbSupervisorService — supervises the local SQLite database.
 *
 * The local SQLite database (node_config, node_mesh_config, local_migrations)
 * is the node's own state store — always managed by the API process itself.
 * It is NOT a docker container: convergence is a no-op (the file plus its
 * schema are initialized at module boot by LocalDatabaseModule), and the
 * health probe measures the real database file:
 *
 *   - SELECT 1 latency (primary liveness of the sqlite engine)
 *   - table inventory (sqlite_master) with count
 *   - journal mode (WAL expected)
 *   - file size on disk (bytes)
 *   - applied migration count (local_migrations)
 *
 * Always registered — unlike the global DB split (managed vs external), the
 * local DB is unconditionally managed by this process.
 */

import { Inject, Injectable } from "@nestjs/common";
import { stat } from "node:fs/promises";
import type { Database as BunSqliteDatabase } from "bun:sqlite";
import z from "zod/v4";

import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@/core/modules/supervisors/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	sqliteProcessInfoSchema,
} from "@/core/modules/supervisors/supervisor-process-info";
import { LOCAL_DATABASE_CONNECTION } from "@/core/modules/database/database-connection";
import type { LocalDatabase } from "@/core/modules/database/local/local-database.service";
import { EnvService } from "@/config/env/env.service";
import { splitManagedEnv } from "@repo/env";

export const LOCAL_DB_SUPERVISOR_ID = "local-db-sqlite";

/** Rich health payload for the local SQLite database. */
export const localDbSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	dbPath: z.string(),
	journalMode: z.string(),
	tableCount: z.number().int().min(0),
	tables: z.array(z.string()),
	migrationsApplied: z.number().int().min(0),
	fileSizeBytes: z.number().int().min(0).nullable(),
	databaseSizeBytes: z.number().int().min(0),
});
export type LocalDbSupervisorPayload = z.output<typeof localDbSupervisorPayloadSchema>;

/**
 * Process info reported by the local-db supervisor through
 * `getProcessInfo()` — the supervised process is the local sqlite file itself.
 */
export const localDbProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: sqliteProcessInfoSchema,
});
export type LocalDbProcessInfo = z.output<typeof localDbProcessInfoSchema>;

@Injectable()
export class LocalDbSupervisorService extends BaseSupervisorService<
	typeof localDbSupervisorPayloadSchema,
	typeof localDbProcessInfoSchema
> {
	static readonly identifier = LOCAL_DB_SUPERVISOR_ID;
	readonly description = "Local SQLite node database (node_config, mesh config, migrations)";

	readonly payloadSchema = localDbSupervisorPayloadSchema;
	readonly processInfoSchema = localDbProcessInfoSchema;

	constructor(
		@Inject(LOCAL_DATABASE_CONNECTION) private readonly db: LocalDatabase,
		private readonly env: EnvService,
	) {
		super();
	}

	/**
	 * The local SQLite node DB is provisioned by the deployment (compose
	 * volume/file mount) when `MANAGED_LOCAL_DB_ENABLED=true` —
	 * the API only probes, never creates the file. Registration is skipped
	 * so health reporting reflects the compose-managed path (external file).
	 */
	override async onModuleInit(): Promise<void> {
		if (this.isComposeManaged()) {
			this.logger.log("Compose-managed local DB detected (MANAGED_LOCAL_DB_ENABLED=true) — supervisor skipped");
			return;
		}
		super.onModuleInit();
	}

	/** True when the deployment owns the local SQLite file (dev compose volume). */
	private isComposeManaged(): boolean {
		return splitManagedEnv(this.env).localDb.enabled === true;
	}

	/**
	 * The local SQLite database is file-backed and fully initialized at module
	 * boot (LocalDatabaseModule runs migrations). Desired state is always "the
	 * file exists" — nothing ever needs creating on demand, so convergence is
	 * a no-op that only verifies the handle is usable.
	 */
	protected async reconcile(): Promise<void> {
		// LocalDatabaseConnection factory already opened + migrated the file at
		// module init. A failed open would have thrown there, so converge=true
		// unless the handle is somehow unusable (SELECT 1 below proves it).
		await this.db.run("SELECT 1");
	}

	/**
	 * REAL health observation of the local SQLite database: engine liveness,
	 * table inventory, journal mode, applied migrations and file size.
	 * Never throws for an unhealthy db — the payload records the failure.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof localDbSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		try {
			await this.db.run("SELECT 1");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				healthy: false,
				detail: `SELECT 1 failed: ${message}`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					dbPath: "unknown",
					journalMode: "unknown",
					tableCount: 0,
					tables: [],
					migrationsApplied: 0,
					fileSizeBytes: null,
					databaseSizeBytes: 0,
				},
			};
		}

		const measurements = await this.readSqliteMeasurements();

		return {
			healthy: true,
			detail: `local sqlite at ${measurements.dbPath} (${String(measurements.tables.length)} tables, ${String(measurements.migrationsApplied)} migrations, journal=${measurements.journalMode})`,
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				...measurements,
			},
		};
	}

	/** Real on-disk + engine measurements of the local sqlite file — shared by
	 *  the health probe (payload) and the process-info view. */
	private async readSqliteMeasurements(): Promise<{
		dbPath: string;
		journalMode: string;
		tableCount: number;
		tables: string[];
		migrationsApplied: number;
		fileSizeBytes: number | null;
		databaseSizeBytes: number;
	}> {
		// Raw sqlite handle for inventory + pragmas. The drizzle bun-sqlite driver
		// exposes the underlying `bun:sqlite` Database as `$client`.
		const sqlite = (this.db as LocalDatabase & { $client: BunSqliteDatabase }).$client;

		// Real on-disk path from sqlite itself (works for file + :memory: DBs;
		// the bun type system does not expose `Database.path`).
		let dbPath = "unknown";
		try {
			const dbList = sqlite.query("PRAGMA database_list").all() as { file: string }[];
			dbPath = dbList[0]?.file && dbList[0].file !== "" ? dbList[0].file : "unknown";
		} catch {
			dbPath = "unknown";
		}
		let databaseSizeBytes = 0;
		let fileSizeBytes: number | null = null;
		let journalMode = "unknown";
		try {
			const pragma = sqlite.query("PRAGMA journal_mode").get() as { journal_mode?: string };
			journalMode = pragma.journal_mode ?? "unknown";
		} catch {
			/* journal mode unavailable — keep unknown */
		}
		try {
			const pageCount = Number((sqlite.query("PRAGMA page_count").get() as { page_count?: number }).page_count ?? 0);
			const pageSize = Number((sqlite.query("PRAGMA page_size").get() as { page_size?: number }).page_size ?? 0);
			databaseSizeBytes = pageCount * pageSize;
		} catch {
			/* size unavailable */
		}
		try {
			const s = await stat(dbPath);
			fileSizeBytes = s.size;
		} catch {
			fileSizeBytes = null;
		}

		// Table inventory.
		const tables = (
			sqlite
				.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
				.all() as { name: string }[]
		).map((r) => r.name);

		// Applied migration count.
		let migrationsApplied = 0;
		try {
			const row = sqlite.query("SELECT COUNT(*) AS count FROM local_migrations").get() as { count: number };
			migrationsApplied = row.count ?? 0;
		} catch {
			migrationsApplied = 0;
		}

		return {
			dbPath,
			journalMode,
			tableCount: tables.length,
			tables,
			migrationsApplied,
			fileSizeBytes,
			databaseSizeBytes,
		};
	}

	/** The entire config + live state of the supervised process — the local
	 *  sqlite file (path, journal mode, inventory, migrations, size). */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const measurements = await this.readSqliteMeasurements();
		return {
			process: {
				kind: "sqlite",
				dbPath: measurements.dbPath,
				journalMode: measurements.journalMode,
				tableCount: measurements.tableCount,
				migrationsApplied: measurements.migrationsApplied,
				fileSizeBytes: measurements.fileSizeBytes,
			},
		};
	}

	/** Payload shape when the probe mechanism itself fails. */
	protected buildDegradedPayload(_detail: string): z.output<typeof localDbSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			dbPath: "unknown",
			journalMode: "unknown",
			tableCount: 0,
			tables: [],
			migrationsApplied: 0,
			fileSizeBytes: null,
			databaseSizeBytes: 0,
		};
	}
}