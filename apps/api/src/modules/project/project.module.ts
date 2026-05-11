import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ProjectController } from "./controllers/project.controller";
import { ProjectRepository } from "./repositories/project.repository";
import { WebhookRepository } from "./repositories/webhook.repository";
import { ApiKeyRepository } from "./repositories/api-key.repository";
import { ProjectService } from "./services/project.service";
import { ProjectEventService } from "./services/project-event.service";
import { WebhookService } from "./services/webhook.service";
import { ApiKeyService } from "./services/api-key.service";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@/core/modules/events/events.module";

@Module({
    imports: [DatabaseModule, ConfigurationCoreModule, EventsModule],
    controllers: [ProjectController],
    providers: [
        ProjectService,
        ProjectRepository,
        ProjectEventService,
        WebhookRepository,
        WebhookService,
        ApiKeyRepository,
        ApiKeyService,
    ],
    exports: [ProjectService, ProjectRepository, ProjectEventService, WebhookService, ApiKeyService],
})
export class ProjectModule {}
