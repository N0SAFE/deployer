import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as globalSchema from "@/config/drizzle/global/schema";
import type * as localSchema from "@/config/drizzle/local/schema";

export abstract class BaseDatabaseService<DB extends NodePgDatabase<typeof globalSchema> | Record<string, unknown>> {
    constructor(private readonly _db: DB) {}

    get db(): DB {
        return this._db
    }

    isHealthy(): boolean {
        try {
            // Duck-typed health checks to avoid importing runtime-specific DB libs
            const anyDb = this._db as unknown as Record<string, unknown>
            if (typeof anyDb.run === 'function') {
                // likely Bun SQLite
                ;(anyDb.run)('SELECT 1')
            } else if (typeof anyDb.execute === 'function') {
                // likely Postgres
                ;(anyDb.execute)('SELECT 1')
            } else {
                throw new Error('Unsupported database type')
            }
            return true
        } catch {
            return false
        }
    }
}
