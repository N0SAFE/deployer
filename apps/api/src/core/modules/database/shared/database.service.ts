import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as globalSchema from '@/config/drizzle/global/schema'
import type * as localSchema from '@/config/drizzle/local/schema'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export abstract class BaseDatabaseService<
    DB extends
        | NodePgDatabase<typeof globalSchema>
        | BunSQLiteDatabase<typeof localSchema>,
> {
    constructor(private readonly _db: DB) {}

    get db(): DB {
        return this._db
    }

    isHealthy(): boolean {
        try {
            // Duck-typed health checks to avoid importing runtime-specific DB libs
            const anyDb = this._db
            if ('run' in anyDb) {
                // likely Bun SQLite
                anyDb.run('SELECT 1')
            } else if ('execute' in anyDb) {
                // likely Postgres
                anyDb.execute('SELECT 1')
            } else {
                throw new Error('Unsupported database type')
            }
            return true
        } catch {
            return false
        }
    }
}
