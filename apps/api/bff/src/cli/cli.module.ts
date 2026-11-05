import { ConfigService } from '@nestjs/config';

import { createModuleContext } from "@deployer/nest-effect";

import { EnvModule } from "@/config/env/env.module";
import { AuthModule } from '@/core/modules/auth/auth.module';
import { AuthCoreService, type AuthCoreServiceShape } from '@/core/modules/auth/services/auth-core.service';
import { DatabaseModule } from "@/core/modules/database/database.module";
import { GlobalDatabaseService, type GlobalDatabaseServiceShape } from '@/core/modules/database/global/global-database.service';
import { LocalDatabaseModule } from "@/core/modules/database/local/local-database.module"
import { NodeStateModule } from '@/core/modules/node-state/node-state.module';
import { MigrationJournalService, makeMigrationJournalService } from '@/core/utils/migration-journal.service';

import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
import { MigrateCommand } from './commands/migrate.command';
import { NodeStartupCheckCommand } from './commands/node-startup-check.command';
import { ResealSecretsCommand } from './commands/reseal-secrets.command';
import { ResetCommand } from './commands/reset.command/index';
import { SeedCommand } from './commands/seed.command/index';
import { SetupDbCommand } from './commands/setup-db.command';
import { CliAuthService } from './services/cli-auth.service';




export class CLIModule extends createModuleContext({
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
    AuthModule,
  ],
  providers: [
    // ── CLI Commands ────────────────────────────────────────────────────
    // A plain class over its collaborators (the CLI has no request and nothing to scope): the module builds it.
    {
      provide: CliAuthService,
      useFactory: (database: GlobalDatabaseServiceShape, auth: AuthCoreServiceShape, config: ConfigService) =>
        new CliAuthService(database, auth, config),
      inject: [GlobalDatabaseService, AuthCoreService, ConfigService],
    },
    SetupDbCommand,
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    CreateDefaultAdminCommand,
    NodeStartupCheckCommand,
    ResealSecretsCommand,
    { provide: MigrationJournalService, useFactory: () => makeMigrationJournalService() },
  ],
}) {}