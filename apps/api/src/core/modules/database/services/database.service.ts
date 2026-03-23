import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DATABASE_CONNECTION } from "../database-connection";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/config/drizzle/schema";
import { logger } from "@repo/logger";

// Define the proper database type with schema
export type Database = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService {
    private _db: Database | null;

    constructor(@Inject(DATABASE_CONNECTION) _db?: Database | null) {
        this._db = _db ?? null;
    }

    /** Live-swap the Postgres connection (used by setup flow after DB URL is configured). */
    setConnection(db: Database | null): void {
        this._db = db;
    }

    /** Returns true when a Postgres connection is available */
    get isConnected(): boolean {
        return this._db !== null;
    }

    /**
     * Get the Drizzle database instance.
     * Throws ServiceUnavailableException when the API is in setup mode
     * (no DATABASE_URL configured yet).
     */
    get db(): Database {
        if (!this._db) {
            throw new ServiceUnavailableException(
                "Database not configured. Complete the setup wizard to connect a Postgres database.",
            );
        }
        return this._db;
    }

    async isHealthy(): Promise<boolean> {
        if (!this._db) {
            return false;
        }
        try {
            await this._db.execute("SELECT 1");
            return true;
        } catch (error) {
            logger.error("Database health check failed", { error });
            return false;
        }
    }
}
