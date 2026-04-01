import { Inject, Injectable } from "@nestjs/common";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as localSchema from "@/config/drizzle/local/schema";
import { LOCAL_DATABASE_CONNECTION } from "../database-connection";

export type LocalDatabase = BunSQLiteDatabase<typeof localSchema>;

@Injectable()
export class LocalDatabaseService {
    constructor(
        @Inject(LOCAL_DATABASE_CONNECTION)
        private readonly _db: LocalDatabase,
    ) {}

    get db(): LocalDatabase {
        return this._db;
    }

    isHealthy(): boolean {
        try {
            this._db.run("SELECT 1");
            return true;
        } catch {
            return false;
        }
    }
}
