import { Module } from "@nestjs/common";
import { CoreInitializationModule } from "@/core/modules/setup/initialization.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { SetupController } from "./controllers/setup.controller";

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
    imports: [CoreInitializationModule, CoreReachabilityModule],
    controllers: [SetupController],
    providers: [],
    exports: [CoreInitializationModule],
})
export class SetupModule {}
