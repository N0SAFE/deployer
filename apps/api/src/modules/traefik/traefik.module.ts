import { Module } from '@nestjs/common';
import { TraefikController } from './controllers/traefik.controller';
import { TraefikService } from './services/traefik.service';
import { DNSService } from './services/dns.service';
import { DatabaseConfigService } from './services/database-config.service';
import { ConfigFileSyncService } from './services/config-file-sync.service';
import { TemplateService } from './services/template.service';
import { TraefikStartupService } from './services/startup.service';
import { TraefikStaticConfigService } from './services/traefik-static-config.service';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    DatabaseModule,
    CoreModule,
  ],
  controllers: [TraefikController],
  providers: [
    TraefikService, 
    DNSService,
    DatabaseConfigService,
    ConfigFileSyncService,
    TemplateService,
    TraefikStartupService,
    TraefikStaticConfigService
  ],
  exports: [
    TraefikService, 
    DNSService,
    DatabaseConfigService,
    ConfigFileSyncService,
    TemplateService,
    TraefikStaticConfigService
  ],
})
export class TraefikModule {}