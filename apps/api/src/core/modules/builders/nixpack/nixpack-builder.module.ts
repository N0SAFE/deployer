import { Module } from '@nestjs/common';
import { NixpackBuilderService } from './nixpack-builder.service';

/**
 * Nixpack Builder Module
 * Provides Nixpacks-based build services
 * 
 * Dependencies:
 * - DockerModule: Docker service for building images (forwardRef due to CoreModule aggregation)
 */
@Module({
  imports: [
    // DockerModule not imported - it's @Global() and imported in CoreModule
  ],
  providers: [NixpackBuilderService],
  exports: [NixpackBuilderService],
})
export class NixpackBuilderModule {}
