import { Module } from "@nestjs/common";
import { SetupController } from "./controllers/setup.controller";
import { CoreInitializationModule } from "@/core/modules/setup/initialization.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";

/**
 * Public Setup Module
 *
 * Wires the HTTP/ORPC surface for the setup wizard:
 *   - `SetupController` (state + pre-flight probes + initialize).
 *   - `CoreInitializationModule` (the underlying `InitializationService`
 *     and the local/remote bootstrap services that `SetupController`
 *     delegates to).
 *   - `CoreReachabilityModule` (the `ReachabilityService` that
 *     `SetupController.probeMesh` delegates to). This is imported
 *     directly so `SetupController` can inject it without relying on
 *     global module side-effects.
 *
 * The probe/initialize orchestration, mesh auth, and per-feature
 * service plumbing live in `CoreInitializationModule` and its imports;
 * this module's only job is to expose the HTTP surface.
 */
@Module({
    imports: [CoreInitializationModule, CoreReachabilityModule],
    controllers: [SetupController],
    providers: [],
    exports: [CoreInitializationModule],
})
export class SetupModule {}
