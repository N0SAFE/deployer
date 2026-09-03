import "reflect-metadata";
import { Logger, type MiddlewareConsumer, Module, RequestMethod, type NestModule } from "@nestjs/common";
import { RenderModule } from "@nestjs-ssr/react";
import { DatabaseModule } from "./core/modules/database/database.module";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { SsrAuthGuardMiddleware } from "./core/middlewares/ssr-auth-guard.middleware";
import { EnvModule } from "./config/env/env.module";
import { EventsModule } from "./core/modules/events/events.module";
import { InternalErrorContextMiddleware } from "./core/middlewares/internal-error/internal-error-context.middleware";
import { InternalErrorInsightService } from "./core/middlewares/internal-error/internal-error-insight.service";
import { InternalErrorExceptionFilter } from "./core/middlewares/internal-error/internal-error-exception.filter";
import { APIErrorExceptionFilter } from "./core/modules/auth/filters/api-error-exception-filter";
import { AppLifecycleModule } from "@repo/nest-lifecycle";
import { BootstrapModule } from "./core/modules/bootstrap/bootstrap.module";
import { SetupModule } from "./modules/setup/setup.module";

// ─── Auth ────────────────────────────────────────────────────────────────────
import { AuthModule } from "./core/modules/auth/auth.module";
import { createBetterAuth } from "./config/auth/auth";
import { GLOBAL_DATABASE_CONNECTION } from "./core/modules/database/database-connection";
import { EnvService } from "./config/env/env.service";
import { eq } from "drizzle-orm";
import * as globalSchema from "@/config/drizzle/global/schema";

// ─── ORPC Auth Plugin ───────────────────────────────────────────────────────
import { ORPCModule } from '@orpc/nest';
import type { ORPCGlobalContext } from '@orpc/nest';
import { AuthPlugin } from '@/core/modules/auth/orpc/plugins/auth.plugin';

// ─── Feature Modules ─────────────────────────────────────────────────────────
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { DeploymentModule } from "./modules/deployment/deployment.module";
import { DockerModule } from "./modules/docker/docker.module";
import { DomainModule } from "./modules/domain/domain.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { HealthModule } from "./modules/health/health.module";
import { PermissionModule } from "./modules/permission/permission.module";
import { ProjectModule } from "./modules/project/project.module";
import { ProviderSchemaModule } from "./modules/provider-schema/provider-schema.module";
import { PushModule } from "./modules/push/push.module";
import { ServiceModule } from "./modules/service/service.module";
import { TestModule } from "./modules/test/test.module";
import { ReachabilityModule } from "./modules/reachability/reachability.module";
import { UserModule } from "./modules/user/user.module";

// ─── Core Modules ────────────────────────────────────────────────────────────
import { ConfigurationCoreModule } from "./core/modules/configuration/configuration-core.module";
import { ProjectCoreModule } from "./core/modules/project/project-core.module";
import { DeploymentCoreModule } from "./core/modules/deployment/deployment-core.module";
import { SupervisorsModule } from "./core/modules/supervisors/supervisors.module";
import { CorePlatformIngressModule } from "./core/modules/platform-ingress/platform-ingress.module";

import { AuthCoreService } from "./core/modules/auth/services/auth-core.service";
import type { ORPCAuthContext } from "./core/modules/auth/orpc/types";
import { logOrpcErrors, transformNestJSErrorToOrpcError } from "./core/modules/auth/orpc/index";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { REQUEST } from "@nestjs/core";

declare module "@orpc/nest" {
    /**
     * Extend oRPC global context to make it type-safe inside your handlers/middlewares
     * Index signatures (both string and symbol) allow compatibility with ORPC's internal
     * MergedInitialContext types which require full index signature compatibility.
     *
     * Per-request data that is NOT universally guaranteed (auth session,
     * app-instance identity) is NOT declared here — it is narrowed in by
     * per-route middlewares (`requireAuth`, `requireAppInstance`) so handlers
     * can rely on presence without null checks.
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
        // Server-rendered React views served by the API itself (same Tailwind
        // theme + @repo/ui as the web app). project=api resolves the nest-cli
        // project "api" (apps/api — the resolved workspace root); dev proxies
        // to the Vite dev server (dev:vite). Production and test never touch
        // the Vite dev server (fail-closed).
        RenderModule.forRoot({
            project: "api",
            viewsDir: "src/views",
            environment:
                process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
                    ? "production"
                    : "development",
            vite: { port: 5173 },
        }),
        // AppLifecycleModule is @Global and provides AppLifecycleService that
        // DatabaseModule's guard injects — init it BEFORE DatabaseModule.
        AppLifecycleModule,
        DatabaseModule,
        BootstrapModule,
        EventsModule,
        // Supervisor FRAMEWORK only — the concrete supervisors (Traefik
        // ingress, failover proxy, DB supervisors) are owned by the GATEWAY
        // app (OrchestrationModule, main.ts) so they run BEFORE and WHILE the
        // setup wizard runs. The framework module provides the PROCESS-WIDE
        // registry + event bus, so health aggregation here observes the
        // gateway-owned supervisors without a second copy.
        SupervisorsModule,
        // Platform helper services (hostname, route config, app-instance,
        // platform settings) — consumed here by the app-instance token plugin.
        CorePlatformIngressModule,

        // ── ORPC — Must be before feature modules ────────────────────────────
        ORPCModule.forRootAsync({
            useFactory: (
                request: Request,
                authCoreService: AuthCoreService,
            ) => {
                const emptyAuthUtils = authCoreService.createEmptyAuthUtils();
                const internalErrorInsightService = new InternalErrorInsightService();

                return {
                    sendResponseInterceptors: [
                        transformNestJSErrorToOrpcError(),
                        logOrpcErrors(new Logger("ORPC Errors"), internalErrorInsightService),
                    ],
                    plugins: [
                        new SmartCoercionPlugin<ORPCGlobalContext>({
                            schemaConverters: [new ZodToJsonSchemaConverter()],
                        }),
                        // Auth plugin that populates context.auth with session data
                        new AuthPlugin<ORPCGlobalContext>({ auth: authCoreService.instance }),
                    ],
                    // Initial context - auth will be populated by AuthPlugin
                    context: { request, auth: emptyAuthUtils },
                };
            },
            inject: [REQUEST, AuthCoreService],
        }),

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

        // ── Feature Modules ──────────────────────────────────────────────
        PlatformModule,
        AnalyticsModule,
        DeploymentModule,
        DockerModule,
        DomainModule,
        FleetModule,
        HealthModule,
        PermissionModule,
        ProjectModule,
        ProviderSchemaModule,
        ProvidersModule,
        PushModule,
        ServiceModule,
        SetupModule,
        TestModule,
        UserModule,
        ReachabilityModule,
    ],
    providers: [
        InternalErrorInsightService,
        InternalErrorExceptionFilter,
        APIErrorExceptionFilter,
        SsrAuthGuardMiddleware,
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(InternalErrorContextMiddleware, LoggerMiddleware).forRoutes("*");

        // Server-side auth guard for API-served SSR pages: every /manage/* page
        // (except the login page itself) requires a Better Auth session. The SSR
        // views call the same `/api/auth` endpoints as the web app.
        consumer
            .apply(SsrAuthGuardMiddleware)
            .exclude({ path: "manage/login", method: RequestMethod.GET })
            .forRoutes("manage", "manage/*");
    }
}
