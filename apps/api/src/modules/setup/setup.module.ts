import { Module } from "@nestjs/common";
import { CoreInitializationModule } from "@/core/modules/setup/initialization.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { EnvModule } from "@/config/env/env.module";
import { SetupController } from "./controllers/setup.controller";
import { PostSetupDestinationService } from "./services/post-setup-destination.service";

/**
 * Public Setup Module
 *
 * Wires the HTTP/ORPC surface for the setup wizard:
 *   - `SetupController` — plain NestJS REST controller exposing setup
 *     endpoints (state, probes, trigger, SSE stream) on the main
 *     Express server BEFORE ORPC is loaded.
 *   - `CoreInitializationModule` (the underlying `InitializationService`
 *     and the local/remote bootstrap services that `SetupController`
 *     delegates to).
 *   - `CoreReachabilityModule` (the `ReachabilityService` that
 *     `SetupController.probeMesh` delegates to).
 *
 * IMPORTANT: This module uses plain NestJS decorators (@Get, @Post, @Sse)
 * instead of ORPC's @Implement. This is intentional — ORPC is lazy-loaded
 * after AuthModule initializes, but the setup wizard must be available
 * upfront so the web UI can configure the database before AuthModule
 * and ORPCModule ever load.
 */
@Module({
    // `EnvModule` IS IMPORTED EXPLICITLY: `PostSetupDestinationService` injects
    // `EnvService`, and `EnvModule` is NOT global — relying on it being
    // registered elsewhere threw `UnknownDependenciesException` at boot:
    //
    //   Nest can't resolve dependencies of the PostSetupDestinationService (?,
    //   HostnameService, PlatformConfigService) — the argument EnvService at
    //   index [0] is available in the SetupModule module?
    //
    // (`HostnameService`/`PlatformConfigService` resolved fine because
    // `CorePlatformIngressModule` IS `@Global()`.)
    imports: [CoreInitializationModule, CoreReachabilityModule, EnvModule],
    controllers: [SetupController],
    providers: [PostSetupDestinationService],
    exports: [CoreInitializationModule, PostSetupDestinationService],
})
export class SetupModule {}
