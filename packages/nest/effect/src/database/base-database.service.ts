import { Logger } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { makeDatabaseHandle, type AnyDrizzleDatabase, type DatabaseHandleShape } from "@deployer/database";
import { AppError } from "@deployer/errors";

/**
 * The base every Drizzle-backed Nest service is built on: it holds a connection and exposes a typed
 * `db`. The holding and the health probe are `@deployer/database`'s (`handle`); this class only
 * answers the plain getters Nest callers use. Generic over the app's schema, so a subclass narrows
 * `db` to its own tables:
 *
 *   class ProjectDatabase extends BaseDatabaseService<NodePgDatabase<typeof mySchema>> {}
 */
export abstract class BaseDatabaseService<DB extends AnyDrizzleDatabase = AnyDrizzleDatabase> {
	protected readonly logger = new Logger(this.constructor.name);

	/** The Effect handle this service exposes. */
	readonly handle: DatabaseHandleShape<DB>;

	constructor(db?: DB) {
		this.handle = makeDatabaseHandle<DB>(this.constructor.name, db);
	}

	/** Initialize (or re-initialize) the database connection. */
	init(db: DB): void {
		this.handle.initNow(db);
	}

	/** Whether this service has been initialized with a database connection. */
	get isInitialized(): boolean {
		return this.handle.dbNow() !== undefined;
	}

	/** The underlying Drizzle database handle. Throws if not yet initialized. */
	get db(): DB {
		const db = this.handle.dbNow();
		if (db === undefined) {
			throw new AppError(`${this.constructor.name} has not been initialized yet`, "DATABASE_NOT_INITIALIZED");
		}
		return db;
	}

	/** Runs `SELECT 1` and resolves to whether the database answered. */
	async probe(): Promise<boolean> {
		return await runPromiseUnwrapped(this.handle.healthy);
	}
}
