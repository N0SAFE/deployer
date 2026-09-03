import { AppError } from "@repo/errors";
import { Logger } from '@nestjs/common'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as globalSchema from '@/config/drizzle/global/schema'
import type * as localSchema from '@/config/drizzle/local/schema'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export abstract class BaseDatabaseService<
    DB extends
        | NodePgDatabase<typeof globalSchema>
        | BunSQLiteDatabase<typeof localSchema>,
> {
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
