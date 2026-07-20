/**
 * SetupWizardInitModule — Provides InitializationService and its dependencies
 * for the setup wizard sub-app context and the main Express API module.
 *
 * Does NOT provide DockerService or PostgresContainerService here — those
 * come from the main app's @Global() CoreDockerModule.
 */

import { Module } from '@nestjs/common';
import { EnvModule } from '@/config/env/env.module';
import { EnvService } from '@/config/env/env.service';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { PostgresContainerService } from '@/core/modules/docker/containers/postgres/postgres-container.service';
import { LocalDatabaseModule } from '@/core/modules/database/local/local-database.module';
import { InitializationService } from '@/core/modules/setup/services/initialization.service';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';
import { LocalInitializationService } from '@/core/modules/setup/services/local-initialization.service';
import { RemoteInitializationService } from '@/core/modules/setup/services/remote-initialization.service';
import { SetupEventService } from '@/core/modules/setup/services/setup-event.service';
import { MeshInitializationModule } from '@/core/modules/mesh/initialization/mesh-initialization.module';
import { CoreReachabilityModule } from '@/core/modules/reachability/core-reachability.module';
import { ReachabilityService } from '@/core/modules/reachability/services/reachability.service';
import { MeshVersionService } from '@/core/modules/mesh/version/mesh-version.service';

@Module({
  imports: [
    EnvModule,
    LocalDatabaseModule,
    MeshInitializationModule,
    CoreReachabilityModule,
  ],
  providers: [
    {
      provide: DockerService,
      useFactory: (envService: EnvService) => new DockerService(envService),
      inject: [EnvService],
    },
    PostgresContainerService,
    SetupEventService,
    LocalInitializationService,
    RemoteInitializationService,
    NodeConfigRepository,
    MeshVersionService,
    ReachabilityService,
    InitializationService,
  ],
  exports: [InitializationService, NodeConfigRepository, SetupEventService, ReachabilityService],
})
export class SetupWizardInitModule {}
