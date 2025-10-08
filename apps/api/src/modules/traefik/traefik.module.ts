import { Module } from '@nestjs/common';
import { TraefikController } from './controllers/traefik.controller';
import { TraefikCoreModule } from '@/core/modules/traefik/traefik.module';

/**
 * FEATURE MODULE: Traefik
 * Provides HTTP endpoints for Traefik configuration management
 * 
 * This is a FEATURE module - it provides HTTP API endpoints.
 * All business logic is in TraefikCoreModule.
 */
@Module({
  imports: [TraefikCoreModule],
  controllers: [TraefikController],
})
export class TraefikModule {}
