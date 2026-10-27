import { Logger, Module } from '@nestjs/common';
import { EnvModule } from "@/config/env/env.module";
import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { LocalDatabaseModule } from "@deployer/nest-database-local/local-database.module";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { AuthModule } from '@/core/modules/auth/auth.module';
import { EnvService } from "@/config/env/env.module";
import { createBetterAuth } from '@/config/auth/auth';
import { CliAuthService } from './services/cli-auth.service';
import { SeedCommand } from './commands/seed.command/index';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command/index';
import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
import { NodeStartupCheckCommand } from './commands/node-startup-check.command';
import { SetupDbCommand } from './commands/setup-db.command';
import { ResealSecretsCommand } from './commands/reseal-secrets.command';
import { MigrationJournalService } from '@/core/utils/migration-journal.service';
import { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository";
import { NodeStateModule } from '@/core/modules/node-state/node-state.module';

@Module({
  imports: [
    EnvModule,
    // ── WHY THE SHARED MODULE, AND NOT A HAND-ROLLED POOL ────────────────
    // `DatabaseModule` is @Global and provides `GLOBAL_DATABASE_POOL`,
    // `GLOBAL_DATABASE_CONNECTION` and `GlobalDatabaseService` — the same three
    // the CLI used to declare inline.
    //
    // Declaring them inline was the source of a PRE-EXISTING failure: the
    // `AuthModule` below injects `GLOBAL_DATABASE_CONNECTION`, and a module
    // resolves the dependencies of what it IMPORTS only from its own imports,
    // so an inline provider was invisible to it and the CLI died before running
    // any command:
    //
    //   Nest can't resolve dependencies of the Symbol(AUTH_MODULE_OPTIONS)
    //   (?, EnvService) … "GLOBAL_DATABASE_CONNECTION" at index [0]
    //
    // Every other app imports `DatabaseModule`; the CLI was the only holdout.
    DatabaseModule,
    LocalDatabaseModule,
    // CLI runs as its OWN Nest context, so the node-state owner is imported
    // explicitly (one declaration per repository — SC8 guard).
    NodeStateModule,
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
    // ── CLI Commands ────────────────────────────────────────────────────
    CliAuthService,
    SetupDbCommand,
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    CreateDefaultAdminCommand,
    NodeStartupCheckCommand,
    ResealSecretsCommand,
    MigrationJournalService,
  ],
})
export class CLIModule {}