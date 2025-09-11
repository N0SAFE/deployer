import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/core/modules/db/database.module';
import { CoreModule } from '@/core/core.module';

import { TraefikController } from './controllers/traefik.controller';
import { TraefikService } from './services/traefik.service';
import { TraefikSyncService } from './services/traefik-sync.service';
import { TraefikFileSystemService } from './services/traefik-file-system.service';
import { TraefikStartupService } from './services/traefik-startup.service';
import { TraefikRepository } from './repositories/traefik.repository';

@Module({
  imports: [ConfigModule, DatabaseModule, CoreModule],
  controllers: [TraefikController],
  providers: [
    TraefikService,
    TraefikSyncService,
    TraefikFileSystemService,
    TraefikStartupService,
    TraefikRepository,
  ],
  exports: [
    TraefikService,
    TraefikSyncService,
    TraefikFileSystemService,
    TraefikStartupService,
    TraefikRepository,
  ],
})
export class TraefikModule {}
