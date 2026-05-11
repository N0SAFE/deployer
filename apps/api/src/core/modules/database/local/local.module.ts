import { Global, Logger, Module } from "@nestjs/common";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import * as localSchema from "@/config/drizzle/local/schema";
import { LOCAL_DATABASE_CONNECTION } from "../database-connection";
import { LocalDatabaseService } from "./local-database.service";

const logger = new Logger("LocalModule");

@Module({
    providers: [
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: () => {
                console.log(`⏳ Initializing local SQLite database connection...`)
                const dbPath = process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db";
                console.log(`Using local SQLite database path: ${dbPath}`);
                const dir = path.dirname(dbPath);
                console.log(`Ensuring local data directory exists at path: ${dir}`);
                if (!fs.existsSync(dir)) {
                    console.log('creating local data directory for SQLite database at path: ' + dir);
                    fs.mkdirSync(dir, { recursive: true });
                    console.log(`Created local data directory: ${dir}`);
                }

                console.log(`Opening local SQLite database: ${dbPath}`);
                const sqlite = new BunSqliteDatabase(dbPath);
                sqlite.run("PRAGMA journal_mode = WAL");

                return drizzleSqlite(sqlite, { schema: localSchema });
            },
        },
        {
            provide: LocalDatabaseService,
            useFactory: (localDbConnection: ReturnType<typeof drizzleSqlite<typeof localSchema>>) => {
                return new LocalDatabaseService(localDbConnection);
            },
            inject: [LOCAL_DATABASE_CONNECTION],
        },
    ],
    exports: [LocalDatabaseService, LOCAL_DATABASE_CONNECTION],
})
export class LocalModule {}