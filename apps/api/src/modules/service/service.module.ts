import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { TraefikModule } from '../traefik/traefik.module';
import { ServiceController } from './controllers/service.controller';
import { ServiceTraefikIntegrationService } from './services/service-traefik-integration.service';

/**
 * Feature Service Module
 * Provides HTTP endpoints and Traefik integration for services
 * 
 * Uses ServiceService from CoreModule for business logic
 * Adds TraefikService integration for service routing
 */
@Module({
    imports: [CoreModule, TraefikModule],
    controllers: [ServiceController],
    providers: [ServiceTraefikIntegrationService],
    exports: [ServiceTraefikIntegrationService],
})
export class ServiceModule {
}
