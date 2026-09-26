import "reflect-metadata";
// The Drizzle schema lives in `@repo/nest-schema` and needs two pieces of APP
// behaviour: the encryption key and the traefik config builder. Both are
// application POLICY (which env var holds the key, whether a missing one is
// fatal), so the package asks for them instead of owning them.
import { registerSchemaCodecs } from "./config/drizzle/schema-codecs";
import { Logger, type MiddlewareConsumer, Module, RequestMethod, type NestModule } from "@nestjs/common";
import { RenderModule } from "@nestjs-ssr/react";
import { DatabaseModule } from "./core/modules/database/database.module";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { SsrAuthGuardMiddleware } from "./core/middlewares/ssr-auth-guard.middleware";
import { EnvModule } from "@/config/env/env.module";
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
import { GLOBAL_DATABASE_CONNECTION } from "@repo/nest-database-core/database-connection";
import { EnvService } from "@/config/env/env.module";
import { eq } from "drizzle-orm";
import * as globalSchema from "@repo/nest-schema/global";

// ─── ORPC Auth Plugin ───────────────────────────────────────────────────────
import { ORPCModule } from '@orpc/nest';
// oRPC v2 request/response compression.
//
// NOTE: `BatchHandlerPlugin` is deliberately NOT enabled. `@orpc/nest` builds a
// StandardHandler per controller method whose `resolveProcedure` is hardcoded to
// that one procedure. A batch sub-request calls `next({ request })` and is
// therefore re-resolved through that same single-procedure resolver, so a batch
// spanning two procedures silently executes one of them twice instead of routing
// each sub-request. The batch client plugin is disabled for the same reason.
import {
    RequestCompressionHandlerPlugin,
    ResponseCompressionHandlerPlugin,
} from '@orpc/server/plugins';
import type { ORPCGlobalContext } from "@/core/modules/auth/orpc/orpc-context";
import { AuthPlugin } from '@/core/modules/auth/orpc/plugins/auth.plugin';

// ─── Feature Modules ─────────────────────────────────────────────────────────
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { DeploymentModule } from "./modules/deployment/deployment.module";
import { DockerModule } from "./modules/docker/docker.module";
import { DomainModule } from "./modules/domain/domain.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { ClusterModule } from "./modules/cluster/cluster.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { HealthModule } from "./modules/health/health.module";
import { PermissionModule } from "./modules/permission/permission.module";
import { ProjectModule } from "./modules/project/project.module";
import { ProviderSchemaModule } from "./modules/provider-schema/provider-schema.module";
import { PushModule } from "./modules/push/push.module";
import { ServiceModule } from "./modules/service/service.module";
import { ReachabilityModule } from "./modules/reachability/reachability.module";
import { UserModule } from "./modules/user/user.module";

// ─── Core Modules ────────────────────────────────────────────────────────────
import { ConfigurationCoreModule } from "./core/modules/configuration/configuration-core.module";
import { ProjectCoreModule } from "./core/modules/project/project-core.module";
import { DeploymentCoreModule } from "./core/modules/deployment/deployment-core.module";
import { SupervisorsModule } from "@repo/nest-supervisor-core/supervisors.module";
import { SwarmInventoryModule } from "./core/modules/swarm/swarm-inventory.module";
import { CorePlatformIngressModule } from "./core/modules/platform-ingress/platform-ingress.module";

import { AuthCoreService } from "./core/modules/auth/services/auth-core.service";
import type { ORPCAuthContext } from "./core/modules/auth/orpc/types";
import { logOrpcErrors, transformNestJSErrorToOrpcError } from "./core/modules/auth/orpc/index";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { REQUEST } from "@nestjs/core";

// Registered at MODULE LOAD, not in a lifecycle hook: the column codecs run
// at QUERY time and the first query can happen during bootstrap — before any
// `onModuleInit`. Doing it here means it cannot be ordered wrong.
registerSchemaCodecs();

declare module "@orpc/server" {
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
    interface DefaultInitialContext {
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
        //
        // `forRoot()` IS REQUIRED: the class is `@Module({})`, so importing it
        // bare registers no providers. Without the call, `AppLifecycleService`
        // is missing from the container and every consumer of it fails to
        // resolve at boot.
        AppLifecycleModule.forRoot(),
        DatabaseModule,
        BootstrapModule,
        EventsModule,
        // Supervisor FRAMEWORK only — the concrete supervisors (Traefik
        // ingress, failover proxy, DB supervisors) are owned by the GATEWAY
        // app (OrchestrationModule, main.ts) so they run BEFORE and WHILE the
        // setup wizard runs. The framework module provides the PROCESS-WIDE
        // registry + event bus, so health aggregation here observes the
        // gateway-owned supervisors without a second copy.
        SupervisorsModule.forRoot(),
        // POST-SETUP swarm half: fleet inventory + shared cluster_nodes
        // enrolment. Needs the global Postgres, so it lives in the main app
        // (which boots after migrations), never in the pre-setup gateway.
        SwarmInventoryModule,
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
                    // oRPC v2 removed `sendResponseInterceptors` from the
                    // handler config — it is silently ignored (the key is not
                    // on ORPCModuleConfig, and excess-property checking does not
                    // fire on this literal, so nothing flagged it). The v2
                    // equivalent is `interceptors`: the post-routing,
                    // pre-error-handler hook. Without this rename the Nest
                    // HttpException and mesh domain-error transforms never run,
                    // and every domain error degrades to a generic 500.
                    interceptors: [
                        transformNestJSErrorToOrpcError(),
                        logOrpcErrors(new Logger("ORPC Errors"), internalErrorInsightService),
                    ],
                    plugins: [
                        // ── Transport: compression ─────
                        //
                        // Request compression is symmetric with the web app's
                        // RequestCompressionLinkPlugin; both default to a 1 KB
                        // threshold so small payloads are never inflated.
                        //
                        // Response compression negotiates from the client's
                        // Accept-Encoding. The web app does not need a
                        // client-side decompression plugin because the fetch
                        // adapter already decompresses transparently.
                        new RequestCompressionHandlerPlugin(),
                        new ResponseCompressionHandlerPlugin({ encodings: ['gzip'] }),

                        // v2 renamed the plugin and its option: the schema-
                        // agnostic Smart Coercion plugin now takes `converters`.
                        new SmartCoercionHandlerPlugin<ORPCGlobalContext>({
                            converters: [new ZodToJsonSchemaConverter()],
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
        ClusterModule,
        HealthModule,
        PermissionModule,
        ProjectModule,
        ProviderSchemaModule,
        ProvidersModule,
        PushModule,
        ServiceModule,
        SetupModule,
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
