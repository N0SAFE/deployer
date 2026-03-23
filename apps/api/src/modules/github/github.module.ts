import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { DeploymentCoreModule } from "@/core/modules/deployment/deployment-core.module";
import { GithubWebhookController } from "./controllers/github-webhook.controller";
import { GithubWebhookDispatchService } from "./services/github-webhook-dispatch.service";
import { WebhookIdempotencyService } from "./services/webhook-idempotency.service";
import { PreviewLifecycleEventService } from "./events/preview-lifecycle-event.service";

@Module({
    imports: [DeploymentCoreModule, ConfigurationCoreModule],
    controllers: [GithubWebhookController],
    providers: [
        GithubWebhookDispatchService,
        WebhookIdempotencyService,
        PreviewLifecycleEventService,
    ],
    exports: [GithubWebhookDispatchService, PreviewLifecycleEventService],
})
export class GithubModule {}
