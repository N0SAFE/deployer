import { Module } from '@nestjs/common';
import { BuildpackBuilderService } from './buildpack-builder.service';

/**
 * Buildpack Builder Module
 * Provides Cloud Native Buildpacks-based build services
 * 
 * Dependencies:
 * - DockerModule: Docker service for building images (forwardRef due to CoreModule aggregation)
 */
@Module({
  imports: [
    // DockerModule not imported - it's @Global() and imported in CoreModule
  ],
  providers: [BuildpackBuilderService],
  exports: [BuildpackBuilderService],
})
export class BuildpackBuilderModule {}
