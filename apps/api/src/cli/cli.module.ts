import { Module } from '@nestjs/common';
import { EnvModule } from '../config/env/env.module';
import { LocalModule } from '../core/modules/database/local/local.module';
import { DatabaseModule } from '../core/modules/database/database.module';
import { GLOBAL_DATABASE_CONNECTION } from '../core/modules/database/database-connection';
import { AuthModule } from '../core/modules/auth/auth.module';
import { EnvService } from '@/config/env/env.service';
import { createBetterAuth } from '@/config/auth/auth';
import { CliAuthService } from './services/cli-auth.service';
import { SeedCommand } from './commands/seed.command/index';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command/index';
import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
import { RegisterMeshNodeCommand } from './commands/register-mesh-node.command';
import { NodeStartupCheckCommand } from './commands/node-startup-check.command';

@Module({
  imports: [
    EnvModule,
    LocalModule,
    DatabaseModule,
    AuthModule.forRootAsync({
      imports: [EnvModule, DatabaseModule],
      useFactory: createBetterAuth,
      inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
      disableBodyParser: true,
      disableGlobalAuthGuard: true,
      disableTrustedOriginsCors: true,
    }),
  ],
  providers: [
    CliAuthService,
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    CreateDefaultAdminCommand,
    RegisterMeshNodeCommand,
    NodeStartupCheckCommand,
  ],
})
export class CLIModule {}