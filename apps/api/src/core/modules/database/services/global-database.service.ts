import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { GLOBAL_DATABASE_CONNECTION } from "../database-connection";
import * as schema from "@/config/drizzle/global/schema";
import { logger } from "@repo/logger";

export type GlobalDatabase = NodePgDatabase<typeof schema>;

@Injectable()
export class GlobalDatabaseService {
    private _db: GlobalDatabase | null;

    constructor(@Inject(GLOBAL_DATABASE_CONNECTION) _db?: GlobalDatabase | null) {
        this._db = _db ?? null;
    }

    setConnection(db: GlobalDatabase | null): void {
        this._db = db;
    }

    get isConnected(): boolean {
        return this._db !== null;
    }

    get db(): GlobalDatabase {
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
