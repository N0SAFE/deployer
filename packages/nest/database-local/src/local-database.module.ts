import {
    Global,
    Logger,
    Module,
    type DynamicModule,
    type InjectionToken,
    type ModuleMetadata,
    type OptionalFactoryDependency,
    type Provider,
} from "@nestjs/common";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import * as localSchema from "@deployer/nest-schema/local";
import { LOCAL_DATABASE_CLIENT, LOCAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { LocalDatabaseLifecycleService } from "./local-database-lifecycle.service";
import { LOCAL_DATABASE_OPTIONS_TOKEN, type LocalDatabaseModuleOptions } from "./local-database.options";
import { LocalDatabaseService } from "./local-database.service";

export type { LocalDatabaseModuleOptions };

const logger = new Logger("LocalDatabaseModule");

export interface LocalDatabaseModuleAsyncOptions {
    /** Modules whose exports the factory injects. */
    imports?: NonNullable<ModuleMetadata["imports"]>;
    /** Tokens the factory's parameters are injected from, in order. */
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    /** Build the options from the injected dependencies. */
    useFactory: (
        ...deps: never[]
    ) => LocalDatabaseModuleOptions | Promise<LocalDatabaseModuleOptions>;
}


@Global()
@Module({})
export class LocalDatabaseModule {
    /**
     * Register the local SQLite connection with values the app already resolved.
     *
     *   LocalDatabaseModule.forRoot({
     *     databasePath: "/app/data/local.db",
     *     migrationsDir: fileURLToPath(new URL("../../config/drizzle/local/migrations", import.meta.url)),
     *   })
     */
    static forRoot(options: LocalDatabaseModuleOptions): DynamicModule {
        return {
            module: LocalDatabaseModule,
            providers: [
                { provide: LOCAL_DATABASE_OPTIONS_TOKEN, useValue: options },
                ...LocalDatabaseModule.providers(),
            ],
            exports: LocalDatabaseModule.exports(),
        };
    }

    /**
     * Register the local SQLite connection with values built from injected
     * dependencies — typically the app's `EnvService`.
     *
     *   LocalDatabaseModule.forRootAsync({
     *     imports: [EnvModule],
     *     inject: [EnvService],
     *     useFactory: (env: EnvService) => ({
     *       databasePath: env.get("NODE_LOCAL_DB_PATH"),
     *       migrationsDir: fileURLToPath(new URL("../../config/drizzle/local/migrations", import.meta.url)),
     *     }),
     *   })
     */
    static forRootAsync(options: LocalDatabaseModuleAsyncOptions): DynamicModule {
        return {
            module: LocalDatabaseModule,
            imports: options.imports ?? [],
            providers: [
                {
                    provide: LOCAL_DATABASE_OPTIONS_TOKEN,
                    useFactory: options.useFactory,
                    inject: options.inject ?? [],
                },
                ...LocalDatabaseModule.providers(),
            ],
            exports: LocalDatabaseModule.exports(),
        };
    }

    /**
     * The provider list, identical for both registration paths.
     *
     * The options arrive through the SAME token either way (a `useValue` in the
     * sync path, a `useFactory` in the async one), so there is exactly one list
     * and the two paths cannot drift.
     */
    private static providers(): Provider[] {
        return [
            {
                // The RAW handle, created ONCE per Nest context. Exposed so the
                // lifecycle service can CLOSE it at shutdown (the Drizzle wrapper
                // exposes no typed accessor for the underlying client).
                provide: LOCAL_DATABASE_CLIENT,
                useFactory: (options: LocalDatabaseModuleOptions): BunSqliteDatabase => {
                    const dbPath = options.databasePath;
                    logger.log("Initializing local SQLite database connection...");
                    logger.log(`Using local SQLite database path: ${dbPath}`);
                    const dir = path.dirname(dbPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    const sqlite = new BunSqliteDatabase(dbPath);
                    // PRAGMAs and migrations are NOT applied here: they run in
                    // `LocalDatabaseLifecycleService.onModuleInit`, so a test can
                    // override this provider with an in-memory handle and skip
                    // every file-system side effect of the real one.
                    return sqlite;
                },
                inject: [LOCAL_DATABASE_OPTIONS_TOKEN],
            },
            {
                provide: LOCAL_DATABASE_CONNECTION,
                useFactory: (sqlite: BunSqliteDatabase) =>
                    drizzleSqlite(sqlite, { schema: localSchema }),
                inject: [LOCAL_DATABASE_CLIENT],
            },
            {
                provide: LocalDatabaseService,
                useFactory: (db: ReturnType<typeof drizzleSqlite<typeof localSchema>>) => {
                    return new LocalDatabaseService(db);
                },
                inject: [LOCAL_DATABASE_CONNECTION],
            },
            // Closes the handle opened by the factory ABOVE, per NestJS context.
            // Each context opens its own `bun:sqlite` handle, so each must release
            // it — including the sub-apps, which are closed mid-boot.
            LocalDatabaseLifecycleService,
        ];
    }

    private static exports(): DynamicModule["exports"] {
        return [LocalDatabaseService, LOCAL_DATABASE_CONNECTION, LOCAL_DATABASE_CLIENT];
    }
}
