import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvModule } from '../config/env/env.module';
import { DatabaseModule } from '../core/modules/database/database.module';
import { AuthModule } from '../core/modules/auth/auth.module';
import { GLOBAL_DATABASE_CONNECTION } from '../core/modules/database/database-connection';
import { SeedCommand } from './commands/seed.command/index';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command/index';
import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
import { RegisterMeshNodeCommand } from './commands/register-mesh-node.command';
import { createBetterAuth } from '@/config/auth/auth';
import { EnvService } from '@/config/env/env.service';
import { GlobalDatabaseService } from '../core/modules/database/services/global-database.service';
import { AuthCoreService } from '../core/modules/auth/services/auth-core.service';
import { DATABASE_SERVICE, AUTH_CORE_SERVICE, CONFIG_SERVICE, ENV_SERVICE, CLI_AUTH_SERVICE_TOKEN } from './tokens';
import { CliAuthService } from './services/cli-auth.service';

@Module({
  imports: [
    ConfigModule,
    EnvModule,
    DatabaseModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule, EnvModule],
      useFactory: createBetterAuth,
      inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
    }),
  ],
  providers: [
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    CreateDefaultAdminCommand,
    RegisterMeshNodeCommand,
    // Token-based providers for CLI commands
    // Required because design:paramtypes shows [null] for class-based injection
    {
      provide: DATABASE_SERVICE,
      useExisting: GlobalDatabaseService,
    },
    {
      provide: AUTH_CORE_SERVICE,
      useExisting: AuthCoreService,
    },
    {
      provide: CONFIG_SERVICE,
      useExisting: ConfigService,
    },
    {
      provide: ENV_SERVICE,
      useExisting: EnvService,
    },
    // CLI-specific services
    CliAuthService,
    {
      provide: CLI_AUTH_SERVICE_TOKEN,
      useExisting: CliAuthService,
    },
  ],
})
export class CLIModule {}