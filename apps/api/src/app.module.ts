import "reflect-metadata";
import { Logger, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { DatabaseModule } from "./core/modules/database/database.module";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { EnvModule } from "./config/env/env.module";
import { EventsModule } from "./core/modules/events/events.module";
import { InternalErrorContextMiddleware } from "./core/middlewares/internal-error/internal-error-context.middleware";
import { InternalErrorInsightService } from "./core/middlewares/internal-error/internal-error-insight.service";
import { InternalErrorExceptionFilter } from "./core/middlewares/internal-error/internal-error-exception.filter";
import { APIErrorExceptionFilter } from "./core/modules/auth/filters/api-error-exception-filter";
import { AppLifecycleModule } from "./core/modules/lifecycle/app-lifecycle.module";
import { BootstrapModule } from "./core/modules/bootstrap/bootstrap.module";
import { SetupModule } from "./modules/setup/setup.module";

// ─── Auth ────────────────────────────────────────────────────────────────────
import { AuthModule } from "./core/modules/auth/auth.module";
import { createBetterAuth } from "./config/auth/auth";
import { GLOBAL_DATABASE_CONNECTION } from "./core/modules/database/database-connection";
import { EnvService } from "./config/env/env.service";

// ─── Feature Modules ─────────────────────────────────────────────────────────
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { DeploymentModule } from "./modules/deployment/deployment.module";
import { DockerModule } from "./modules/docker/docker.module";
import { DomainModule } from "./modules/domain/domain.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { GithubModule } from "./modules/github/github.module";
import { HealthModule } from "./modules/health/health.module";
import { OrganizationModule } from "./modules/organization/organization.module";
import { PermissionModule } from "./modules/permission/permission.module";
import { ProjectModule } from "./modules/project/project.module";
import { ProviderSchemaModule } from "./modules/provider-schema/provider-schema.module";
import { PushModule } from "./modules/push/push.module";
import { ServiceModule } from "./modules/service/service.module";
import { TestModule } from "./modules/test/test.module";
import { UserModule } from "./modules/user/user.module";

// ─── Core Modules ────────────────────────────────────────────────────────────
import { ConfigurationCoreModule } from "./core/modules/configuration/configuration-core.module";
import { ProjectCoreModule } from "./core/modules/project/project-core.module";
import { DeploymentCoreModule } from "./core/modules/deployment/deployment-core.module";

import type { ORPCAuthContext } from "./core/modules/auth/orpc/types";

declare module "@orpc/nest" {
    /**
     * Extend oRPC global context to make it type-safe inside your handlers/middlewares
     * Index signatures (both string and symbol) allow compatibility with ORPC's internal
     * MergedInitialContext types which require full index signature compatibility.
     */
    interface ORPCGlobalContext {
        request: Request;
        auth: ORPCAuthContext;
        [key: string]: unknown;
        [key: symbol]: unknown;
    }
}

@Module({
    imports: [
        // ── Foundation ────────────────────────────────────────────────────────
        EnvModule,
        DatabaseModule,
        AppLifecycleModule,
        BootstrapModule,
        EventsModule,

        // ── Core (shared services) ────────────────────────────────────────────
        ConfigurationCoreModule,
        ProjectCoreModule,
        DeploymentCoreModule,

        // ── Auth ──────────────────────────────────────────────────────────────
        AuthModule.forRootAsync({
            imports: [EnvModule],
            useFactory: createBetterAuth,
            inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
        }),

        // ── Feature Modules ───────────────────────────────────────────────────
        AnalyticsModule,
        DeploymentModule,
        DockerModule,
        DomainModule,
        FleetModule,
        GithubModule,
        HealthModule,
        OrganizationModule,
        PermissionModule,
        ProjectModule,
        ProviderSchemaModule,
        PushModule,
        ServiceModule,
        SetupModule,
        TestModule,
        UserModule,
    ],
    providers: [
        InternalErrorInsightService,
        InternalErrorExceptionFilter,
        APIErrorExceptionFilter,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(InternalErrorContextMiddleware, LoggerMiddleware).forRoutes("*");
    }
}
