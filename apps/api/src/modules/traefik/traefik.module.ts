import { Module } from '@nestjs/common';
import { TraefikController } from './controllers/traefik.controller';
import { TraefikService } from './services/traefik.service';
import { DNSService } from './services/dns.service';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    DatabaseModule,
    CoreModule,
  ],
  controllers: [TraefikController],
  providers: [TraefikService, DNSService],
  exports: [TraefikService, DNSService],
})
export class TraefikModule {}