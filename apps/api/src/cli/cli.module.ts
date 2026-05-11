import { Module } from '@nestjs/common';
import { EnvModule } from '../config/env/env.module';
import { DatabaseModule } from '../core/modules/database/database.module';
// import { AuthModule } from '../core/modules/auth/auth.module';
// import { GLOBAL_DATABASE_CONNECTION } from '../core/modules/database/database-connection';
import { SeedCommand } from './commands/seed.command/index';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command/index';
// import { CreateDefaultAdminCommand } from './commands/create-default-admin.command';
// import { RegisterMeshNodeCommand } from './commands/register-mesh-node.command';
// import { createBetterAuth } from '@/config/auth/auth';
// import { EnvService } from '@/config/env/env.service';
// import { CliAuthService } from './services/cli-auth.service';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    // AuthModule.forRootAsync({
    //   imports: [EnvModule, DatabaseModule],
    //   useFactory: createBetterAuth,
    //   inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
    // }),
  ],
  providers: [
    SeedCommand,
    MigrateCommand,
    ResetCommand,
    // CreateDefaultAdminCommand,
    // RegisterMeshNodeCommand,
    // CliAuthService,
  ],
})
export class CLIModule {}