/**
 * SetupWizardInitModule — Provides InitializationService and its dependencies
 * for the setup wizard sub-app context and the main Express API module.
 *
 * Does NOT provide DockerService or PostgresServiceProvisioner here — those
 * come from the main app's @Global() CoreDockerModule.
 */

import { Module } from '@nestjs/common';
import { EnvModule } from '@repo/nest-env';
import { EnvService } from '@repo/nest-env';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { PostgresServiceProvisioner } from '@/core/modules/docker/containers/postgres/postgres-service.provisioner';
import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module";
import { InitializationService } from '@/core/modules/setup/services/initialization.service';
import { NodeStateModule } from '@/core/modules/node-state/node-state.module';
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
    // Sub-app context: import the node-state owner instead of redeclaring
    // NodeConfigRepository (SC8 guard: one declaration per repository).
    NodeStateModule,
  ],
  providers: [
    {
      provide: DockerService,
      useFactory: (envService: EnvService) => new DockerService(envService),
      inject: [EnvService],
    },
    PostgresServiceProvisioner,
    SetupEventService,
    LocalInitializationService,
    RemoteInitializationService,
    MeshVersionService,
    ReachabilityService,
    InitializationService,
  ],
  exports: [InitializationService, SetupEventService, ReachabilityService],
})
export class SetupWizardInitModule {}
