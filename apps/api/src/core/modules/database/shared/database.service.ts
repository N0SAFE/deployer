import { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as globalSchema from "@/config/drizzle/global/schema";
import type * as localSchema from "@/config/drizzle/local/schema";

export abstract class BaseDatabaseService<DB extends NodePgDatabase<typeof globalSchema> | BunSQLiteDatabase<typeof localSchema>> {
     constructor(
        private readonly _db: DB,
    ) {}
    
    get db(): DB {
        return this._db;
    }

    isHealthy(): boolean {
        try {
            if (this._db instanceof BunSQLiteDatabase) {
                this._db.run("SELECT 1");
            } else if (this._db instanceof NodePgDatabase) {
                this._db.execute("SELECT 1");
            } else {
                throw new Error("Unsupported database type");
            }
            return true
        } catch {
            return false;
        }
    }
}
