import "reflect-metadata";
import { Logger, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { DatabaseModule } from "./core/modules/database/database.module";
import { HealthModule } from "./modules/health/health.module";
import { UserModule } from "./modules/user/user.module";
import { PushModule } from "./modules/push/push.module";
import { ORPCModule } from "@orpc/nest";
import { GLOBAL_DATABASE_CONNECTION } from "./core/modules/database/database-connection";
import { AuthModule } from "./core/modules/auth/auth.module";
import { AuthCoreService } from "./core/modules/auth/services/auth-core.service";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { createBetterAuth } from "./config/auth/auth";
import { EnvService } from "./config/env/env.service";
import { EnvModule } from "./config/env/env.module";
import { REQUEST } from "@nestjs/core";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { ORPCAuthContext } from "./core/modules/auth/orpc/types";
import { TestModule } from "./modules/test/test.module";
import { AuthPlugin } from "./core/modules/auth/orpc/plugins/auth.plugin";
import { transformNestJSErrorToOrpcError, logOrpcErrors } from "./core/modules/auth/orpc/interceptors";
import { OrganizationModule } from "./modules/organization/organization.module";
import { ProjectModule } from "./modules/project/project.module";
import { ServiceModule } from "./modules/service/service.module";
import { DeploymentModule } from "./modules/deployment/deployment.module";
import { GithubModule } from "./modules/github/github.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { EventsModule } from "./core/modules/events/events.module";
import { DomainModule } from "./modules/domain/domain.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { ProviderSchemaModule } from "./modules/provider-schema/provider-schema.module";
import { SystemModule } from "./system/system.module";
import { CoreInitializationModule } from "./core/modules/setup/initialization.module";
import { PermissionModule } from "./modules/permission/permission.module";
import { DockerModule } from "./modules/docker/docker.module";
import { InternalErrorContextMiddleware } from "./core/middlewares/internal-error/internal-error-context.middleware";
import { InternalErrorInsightService } from "./core/middlewares/internal-error/internal-error-insight.service";
import { InternalErrorExceptionFilter } from "./core/middlewares/internal-error/internal-error-exception.filter";
import { APIErrorExceptionFilter } from "./core/modules/auth/filters/api-error-exception-filter";
import { SetupModule } from "./modules/setup/setup.module";

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
        EnvModule,
        DatabaseModule,
        AuthModule.forRootAsync({
            imports: [DatabaseModule, EnvModule],
            useFactory: createBetterAuth,
            inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
            disableBodyParser: false,
            disableGlobalAuthGuard: true,
        }),
        HealthModule,
        UserModule,
        PushModule,
        TestModule,
        CoreInitializationModule,
        OrganizationModule,
        ProjectModule,
        ServiceModule,
        DeploymentModule,
        GithubModule,
        FleetModule,
        DomainModule,
        AnalyticsModule,
        ProviderSchemaModule,
        DockerModule,
        EventsModule,
        SystemModule,
        PermissionModule,
        SetupModule,
        ORPCModule.forRootAsync({
            useFactory: (
                request: Request,
                authCoreService: AuthCoreService,
            ) => {
                const emptyAuthUtils = authCoreService.createEmptyAuthUtils();
                const internalErrorInsightService = new InternalErrorInsightService();

                return {
                    interceptors: [
                        transformNestJSErrorToOrpcError(),
                        logOrpcErrors(new Logger("ORPC Errors"), internalErrorInsightService),
                    ],
                    plugins: [
                        new SmartCoercionPlugin({
                            schemaConverters: [new ZodToJsonSchemaConverter()],
                        }),
                        // Auth plugin that populates context.auth with session data
                        new AuthPlugin({ auth: authCoreService.instance }),
                    ],
                    // Initial context - auth will be populated by AuthPlugin
                    context: { request, auth: emptyAuthUtils },
                    eventIteratorKeepAliveInterval: 5000, // 5 seconds
                };
            },
            inject: [REQUEST, AuthCoreService],
        }),
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
