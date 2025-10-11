import { Module } from '@nestjs/common';
import { EnvModule } from '@/config/env/env.module';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { AuthModule } from '@/core/modules/auth/auth.module';
import { CoreModule } from '@/core/core.module';
import { TraefikCoreModule } from '@/core/modules/traefik/traefik.module';
import { SeedCommand } from './commands/seed.command';
import { MigrateCommand } from './commands/migrate.command';
import { ResetCommand } from './commands/reset.command';
import { betterAuthFactory } from '@/config/auth/auth';
import { EnvService } from '@/config/env/env.service';
import { DATABASE_CONNECTION } from '@/core/modules/database/tokens/database-connection';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    CoreModule,
    TraefikCoreModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule, EnvModule],
      useFactory: betterAuthFactory,
      inject: [DATABASE_CONNECTION, EnvService],
    }),
  ],
  providers: [
    SeedCommand,
    MigrateCommand,
    ResetCommand,
  ],
})
export class CLIModule {}