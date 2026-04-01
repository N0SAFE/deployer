import "reflect-metadata";
import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
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
import { SetupModule } from "./modules/setup/setup.module";
import { PermissionModule } from "./modules/permission/permission.module";

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
        SetupModule,
        OrganizationModule,
        ProjectModule,
        ServiceModule,
        DeploymentModule,
        GithubModule,
        FleetModule,
        DomainModule,
        AnalyticsModule,
        ProviderSchemaModule,
        EventsModule,
        SystemModule,
        PermissionModule,
        ORPCModule.forRootAsync({
            useFactory: (request: Request, authCoreService: AuthCoreService) => {
                const emptyAuthUtils = authCoreService.createEmptyAuthUtils();

                return {
                    interceptors: [transformNestJSErrorToOrpcError(), logOrpcErrors()],
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
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(LoggerMiddleware).forRoutes("*"); // Apply the logger middleware to all routes
    }
}
