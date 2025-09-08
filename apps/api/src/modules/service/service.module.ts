import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { TraefikModule } from '../traefik/traefik.module';
import { ServiceController } from './controllers/service.controller';
import { ServiceService } from './services/service.service';
import { ServiceRepository } from './repositories/service.repository';

@Module({
  imports: [CoreModule, TraefikModule],
  controllers: [ServiceController],
  providers: [ServiceService, ServiceRepository],
  exports: [ServiceService, ServiceRepository],
})
export class ServiceModule {}
