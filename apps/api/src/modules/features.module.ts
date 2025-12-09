import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { CiCdModule } from "./ci-cd/ci-cd.module";
import { DeploymentModule } from "./deployment/deployment.module";
import { DomainControllerModule } from "./domain/domain.module";
import { EnvironmentModule } from "./environment/environment.module";
import { GitHubFeatureModule } from "./github/github-feature.module";
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
    DomainControllerModule, // Domain management controllers (organization, project, service domains)
    OrchestrationControllerModule,
    StorageModule,
    StaticFileModule,
    AnalyticsModule,
    CiCdModule,
    GitHubFeatureModule, // Unified GitHub feature module (OAuth + Webhooks)
  ],
})
export class FeaturesModule {}
