import { AppError } from "@repo/errors";
import { Logger } from '@nestjs/common'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

/**
 * Any Drizzle database handle this base class can hold.
 *
 * GENERIC OVER THE APP'S SCHEMA, NOT BOUND TO OURS
 * An earlier version constrained this to the API's two schemas
 * (`NodePgDatabase<typeof globalSchema> | BunSQLiteDatabase<typeof localSchema>`),
 * which meant the base class could only ever be used by an app that happened to
 * have exactly those tables. The constraint is not a framework need — the class
 * only stores a handle and runs `SELECT 1` — so it was the app's schema leaking
 * into a shared primitive.
 *
 * Widening to any Drizzle database keeps the base usable by any app, while a
 * subclass still narrows `db` to its own tables:
 *
 *   class ProjectDatabase extends BaseDatabaseService<NodePgDatabase<typeof mySchema>> {}
 */
export type AnyDrizzleDatabase =
    | NodePgDatabase<Record<string, never>>
    | BunSQLiteDatabase<Record<string, never>>
    | NodePgDatabase<Record<string, unknown>>
    | BunSQLiteDatabase<Record<string, unknown>>;

export abstract class BaseDatabaseService<DB extends AnyDrizzleDatabase = AnyDrizzleDatabase> {
    protected readonly logger = new Logger(this.constructor.name)
    private _db: DB | undefined

    constructor(db?: DB) {
        this._db = db
    }

    /** Initialize (or re-initialize) the database connection. */
    init(db: DB): void {
        this._db = db
    }

    /** Whether this service has been initialized with a database connection. */
    get isInitialized(): boolean {
        return this._db !== undefined
    }

    /** The underlying Drizzle database handle. Throws if not yet initialized. */
    get db(): DB {
        if (!this._db) {
            throw new AppError(`${this.constructor.name} has not been initialized yet`, `DATABASE_NOT_INITIALIZED`)
        }
        return this._db
    }

    isHealthy(): boolean {
        try {
            if (!this._db) return false
            // Duck-typed health checks to avoid importing runtime-specific DB libs
            const anyDb = this._db
            if ('run' in anyDb) {
                // likely Bun SQLite
                anyDb.run('SELECT 1')
            } else if ('execute' in anyDb) {
                // likely Postgres
                anyDb.execute('SELECT 1')
            } else {
                throw new AppError('Unsupported database type', 'DATABASE_NOT_INITIALIZED')
            }
            return true
        } catch (err: unknown) {
            this.logger.warn(`Health check failed: ${err instanceof Error ? err.message : String(err)}`)
            return false
        }
    }
}
