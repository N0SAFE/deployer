import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { CiCdModule } from "./ci-cd/ci-cd.module";
import { DeploymentModule } from "./deployment/deployment.module";
import { EnvironmentModule } from "./environment/environment.module";
import { GitHubOAuthModule } from "./github-oauth/github-oauth.module";
import { GitHubWebhookModule } from "./github-webhook/github-webhook.module";
import { HealthMonitorModule } from "./health-monitor/health-monitor.module";
import { HealthModule } from "./health/health.module";
import { OrchestrationControllerModule } from "./orchestration/orchestration.module";
import { ProjectModule } from "./project/project.module";
import { ProvidersSchemaModule } from "./providers/providers-schema.module";
import { ServiceModule } from "./service/service.module";
import { SetupModule } from "./setup/setup.module";
import { StaticFileModule } from "./static-file/static-file.module";
import { StorageModule } from "./storage/storage.module";
import { TraefikModule } from "./traefik";
import { UserModule } from "./user/user.module";
import { WebSocketModule } from "./websocket/websocket.module";

@Module({
  imports: [
    HealthModule,
    HealthMonitorModule,
    UserModule,
    SetupModule,
    WebSocketModule,
    TraefikModule,
    ProjectModule,
    ProvidersSchemaModule,
    ServiceModule,
    EnvironmentModule,
    DeploymentModule,
    OrchestrationControllerModule,
    StorageModule,
    StaticFileModule,
    AnalyticsModule,
    CiCdModule,
    GitHubWebhookModule, // GitHub webhook event handling (separated from core for dependency resolution)
    GitHubOAuthModule, // GitHub OAuth authentication flow (separated from core - controllers belong in features)
  ],
})
export class FeaturesModule {}
