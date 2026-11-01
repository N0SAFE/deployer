import { createModuleContext } from "@deployer/nest-effect";
import { Module } from "@nestjs/common"
import { EventsModule as CoreEventsModule } from "@deployer/shared/core/modules/events/events.module"
import { DockerCommonModule } from "../../common/docker-common.module"
import { DockerContainersModule } from "../containers/docker-containers.module"
import { DockerImagesModule } from "../images/docker-images.module"
import { DockerCatalogModule } from "../../catalog/docker-catalog.module"
import { EffectRuntime } from "@deployer/nest-effect"
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index"
import { DockerImagesOrchestratorService } from "../images/orchestration/docker-images-orchestrator.service"
import { DockerRuntimeEventsStreamService } from "../../common/events/docker-runtime-events-stream.service"
import { DockerEntityCacheService } from "./orchestration/docker-entity-cache.service"
import { DockerEntityDomainService } from "./orchestration/docker-entity-domain.service"
import { DockerEntityOrchestratorService } from "./orchestration/docker-entity-orchestrator.service"
import { DockerEntity, DockerEntityPort } from "./orchestration/docker-entity.service"

export class DockerEntityModule extends createModuleContext({
  imports: [
    CoreEventsModule,
    DockerCommonModule,
    DockerContainersModule,
    DockerImagesModule,
    DockerCatalogModule,
  ],
  providers: [
    // Built by factories rather than by decorator.
    { provide: DockerEntityCacheService, useFactory: () => new DockerEntityCacheService() },
    {
      provide: DockerEntityDomainService,
      useFactory: (
        images: DockerImagesOrchestratorService,
        runtime: EffectRuntime,
        events: DockerRuntimeEventsStreamService,
        pool: CoreEventStreamPoolService,
        cache: DockerEntityCacheService,
      ) => new DockerEntityDomainService(images, runtime, events, pool, cache),
      inject: [DockerImagesOrchestratorService, EffectRuntime, DockerRuntimeEventsStreamService, CoreEventStreamPoolService, DockerEntityCacheService],
    },
    {
      provide: DockerEntityOrchestratorService,
      useFactory: (domain: DockerEntityDomainService) => new DockerEntityOrchestratorService(domain),
      inject: [DockerEntityDomainService],
    },
    // The Effect face of the entity facade: a port over the Promise orchestrator, so a handler's `R` names it.
    { provide: DockerEntityPort, useExisting: DockerEntityOrchestratorService },
    { provide: DockerEntity, useValue: DockerEntity.live },
  ],
  exports: [
    DockerEntityCacheService,
    DockerEntityDomainService,
    DockerEntityOrchestratorService,
    DockerEntity,
    DockerEntityPort,
  ],
}) {}
