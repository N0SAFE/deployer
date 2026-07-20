import { Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as globalSchema from '@/config/drizzle/global/schema';
import { EnvModule } from '../config/env/env.module';
import { LocalDatabaseModule } from '../core/modules/database/local/local-database.module';
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from '../core/modules/database/database-connection';
import { GlobalDatabaseService } from '../core/modules/database/global/global-database.service';
import { AuthModule } from '../core/modules/auth/auth.module';
import { EnvService } from '@/config/env/env.service';
import { createBetterAuth } from '@/config/auth/auth';
import { CliAuthService } from './services/cli-auth.service';
import { SeedCommand } from './commands/seed.command/index';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command/index';
import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
import { NodeStartupCheckCommand } from './commands/node-startup-check.command';
import { SetupDbCommand } from './commands/setup-db.command';
import { MigrationJournalService } from '@/core/utils/migration-journal.service';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';

const logger = new Logger('CLIModule');

/**
 * Resolve the database URL for CLI commands.
 * CLI reads from SETUP_DATABASE_URL env var first (for setup/bootstrap),
 * then falls back to the local SQLite node_config (populated by Phase 0).
 */
function resolveCliDatabaseUrl(envService: EnvService, nodeConfig: NodeConfigRepository): string {
  // 1. SETUP_DATABASE_URL env var (for CLI bootstrap commands)
  const envUrl = envService.get('SETUP_DATABASE_URL') ?? process.env.SETUP_DATABASE_URL
  if (envUrl) {
    logger.log('📦 Using database URL from SETUP_DATABASE_URL env var')
    return envUrl
  }

  // 2. Node config (local SQLite) — Phase 0 or CLI setup-db may have saved the URL there
  const config = nodeConfig.find()
  if (config?.databaseUrl) {
    logger.log('📦 Using database URL from node config (local SQLite)')
    return config.databaseUrl
  }

  // 3. No URL available — return empty (will fail on first query)
  logger.warn('⚠️  No database URL available — CLI commands that need the global DB will fail')
  return ''
}

@Module({
  imports: [
    EnvModule,
    LocalDatabaseModule,
    AuthModule.forRootAsync({
      imports: [EnvModule],
      useFactory: createBetterAuth,
      inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
      disableBodyParser: true,
      disableGlobalAuthGuard: true,
      disableTrustedOriginsCors: true,
    }),
  ],
  providers: [
    // ── Global DB for CLI (direct pool — no bridge dependency) ──────────
    {
      provide: GLOBAL_DATABASE_POOL,
      useFactory: (envService: EnvService, nodeConfig: NodeConfigRepository): Pool => {
        const databaseUrl = resolveCliDatabaseUrl(envService, nodeConfig)
        return new Pool({ connectionString: databaseUrl })
      },
      inject: [EnvService, NodeConfigRepository],
    },
    {
      provide: GLOBAL_DATABASE_CONNECTION,
      useFactory: (pool: Pool) => {
        logger.log('📦 Creating Drizzle instance from pool')
        return drizzle(pool, { schema: globalSchema })
      },
      inject: [GLOBAL_DATABASE_POOL],
    },
    {
      provide: GlobalDatabaseService,
      useFactory: (db: ReturnType<typeof drizzle<typeof globalSchema>>) => {
        return new GlobalDatabaseService(db)
      },
      inject: [GLOBAL_DATABASE_CONNECTION],
    },
    // ── CLI Commands ────────────────────────────────────────────────────
    NodeConfigRepository,
    CliAuthService,
    SetupDbCommand,
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    CreateDefaultAdminCommand,
    NodeStartupCheckCommand,
    MigrationJournalService,
  ],
})
export class CLIModule {}