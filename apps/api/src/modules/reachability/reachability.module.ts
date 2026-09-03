/**
 * Reachability Module
 *
 * Feature module providing HTTP endpoints for URL reachability checking,
 * domain DNS resolution, per-node network config and tunnel provisioning.
 */
import { Module } from "@nestjs/common";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { ReachabilityController } from "./controllers/reachability.controller";

@Module({
    imports: [CoreReachabilityModule, ProvidersModule, TraefikCoreModule],
    controllers: [ReachabilityController],
    exports: [],
})
export class ReachabilityModule {}
