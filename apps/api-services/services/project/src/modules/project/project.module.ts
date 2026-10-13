import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ProjectController } from "./controllers/project.controller";
import { ProjectRepository } from "./repositories/project.repository";
import { WebhookRepository } from "./repositories/webhook.repository";
import { ApiKeyRepository } from "./repositories/api-key.repository";
import { ProjectService } from "./services/project.service";
import { ProjectEventService } from "./services/project-event.service";
import { ProjectNetworkService } from "./services/project-network.service";
import { WebhookService } from "./services/webhook.service";
import { ApiKeyService } from "./services/api-key.service";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { CoreDomainModule } from "@/core/modules/domain/domain.module";

@Module({
    imports: [DatabaseModule, ConfigurationCoreModule, EventsModule, ProvidersModule, CoreDomainModule],
    controllers: [ProjectController],
    providers: [
        ProjectService,
        ProjectRepository,
        ProjectEventService,
        ProjectNetworkService,
        WebhookRepository,
        WebhookService,
        ApiKeyRepository,
        ApiKeyService,
    ],
    exports: [ProjectService, ProjectRepository, ProjectEventService, ProjectNetworkService, WebhookService, ApiKeyService],
})
export class ProjectModule {}
