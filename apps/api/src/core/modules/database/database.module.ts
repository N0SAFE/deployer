import { Module, Global, Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { DatabaseService } from "./services/database.service";
import { DATABASE_CONNECTION, DATABASE_POOL } from "./database-connection";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../config/drizzle/schema";
import { EnvService } from "../../../config/env/env.service";
import { EnvModule } from "../../../config/env/env.module";
import { LocalDatabaseModule } from "../local-database/local-database.module";
import { LocalDatabaseService } from "../local-database/local-database.service";
import { nodeConfig } from "@/config/drizzle/local-schema";

const logger = new Logger("DatabaseModule");

@Injectable()
class DatabasePoolLifecycleService implements OnModuleDestroy {
    constructor(@Optional() private readonly pool: Pool | null) {}

    async onModuleDestroy(): Promise<void> {
        if (!this.pool) {
            return;
        }

        await this.pool.end();
    }
}

@Global()
@Module({
    imports: [EnvModule, LocalDatabaseModule],
    providers: [
        DatabaseService,
        {
            provide: DATABASE_POOL,
            useFactory: (envService: EnvService, localDb: LocalDatabaseService) => {
                // Env var takes priority (useful for compose overrides, CI, tests)
                const urlFromEnv = envService.get("DATABASE_URL");
                const urlFromConfig = urlFromEnv
                    ? undefined
                    : (localDb.db
                          .select({ databaseUrl: nodeConfig.databaseUrl })
                          .from(nodeConfig)
                          .limit(1)
                          .all()[0]?.databaseUrl ?? undefined);

                const connectionString = urlFromEnv ?? urlFromConfig;

                if (!connectionString) {
                    logger.warn(
                        "No DATABASE_URL configured — starting in setup mode. " +
                        "Connect to a Postgres database through the setup wizard.",
                    );
                    return null;
                }

                logger.log(`Connecting to Postgres (source: ${urlFromEnv ? "env" : "local config"})`);
                return new Pool({ connectionString });
            },
            inject: [EnvService, LocalDatabaseService],
        },
        {
            provide: DATABASE_CONNECTION,
            useFactory: (pool: Pool | null) => {
                if (!pool) {
                    return null;
                }
                return drizzle(pool, { schema });
            },
            inject: [DATABASE_POOL],
        },
        DatabasePoolLifecycleService,
    ],
    exports: [DatabaseService, DATABASE_CONNECTION],
})
export class DatabaseModule {}
