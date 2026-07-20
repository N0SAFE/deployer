/**
 * CORE MODULE: Docker
 * Provides Docker infrastructure services for container management.
 *
 * DockerService is created directly from EnvService (no trigger proxy).
 * The docker sub-app has been removed — Docker is now a permanent core module.
 */

import { Global, Module } from '@nestjs/common';
import { EnvService } from '@/config/env/env.service';
import { DockerService } from './services/docker.service';
import { ScannerContainerManagerService } from './services/scanner-container-manager.service';
import { PostgresContainerService } from './containers/postgres/postgres-container.service';
import { EnvModule } from '@/config/env/env.module';

@Global()
@Module({
  imports: [EnvModule],
  providers: [
    {
      provide: DockerService,
      useFactory: (envService: EnvService): DockerService => {
        return new DockerService(envService);
      },
      inject: [EnvService],
    },
    ScannerContainerManagerService,
    PostgresContainerService,
  ],
  exports: [DockerService, ScannerContainerManagerService, PostgresContainerService],
})
export class CoreDockerModule {}
