import { Module } from '@nestjs/common';
import { StaticBuilderService } from './static-builder.service';

/**
 * Static Builder Module
 * Provides static file build services
 * 
 * Dependencies:
 * - DockerService: Injected from global DockerModule (no import needed)
 * 
 * Note: StaticProviderService is no longer injected - it's passed as a parameter to break circular dependency
 */
@Module({
  imports: [
  ],
  providers: [StaticBuilderService],
  exports: [StaticBuilderService],
})
export class StaticBuilderModule {}
