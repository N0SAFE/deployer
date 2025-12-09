import { Module } from '@nestjs/common';
import { DockerComposeBuilderService } from './docker-compose-builder.service';

/**
 * Docker Compose Builder Module
 * Provides Docker Compose-based build services
 * 
 * Dependencies:
 * - DockerModule: Docker service for building images (forwardRef due to CoreModule aggregation)
 */
@Module({
  imports: [
    // DockerModule not imported - it's @Global() and imported in CoreModule
  ],
  providers: [DockerComposeBuilderService],
  exports: [DockerComposeBuilderService],
})
export class DockerComposeBuilderModule {}
