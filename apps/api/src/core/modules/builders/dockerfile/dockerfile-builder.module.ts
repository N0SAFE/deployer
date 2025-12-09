import { Module } from '@nestjs/common';
import { DockerfileBuilderService } from './dockerfile-builder.service';

/**
 * Dockerfile Builder Module
 * Provides Dockerfile-based build services
 * 
 * Dependencies:
 * - DockerModule: Docker service for building images (forwardRef due to CoreModule aggregation)
 */
@Module({
  imports: [
    // DockerModule not imported - it's @Global() and imported in CoreModule
  ],
  providers: [DockerfileBuilderService],
  exports: [DockerfileBuilderService],
})
export class DockerfileBuilderModule {}
