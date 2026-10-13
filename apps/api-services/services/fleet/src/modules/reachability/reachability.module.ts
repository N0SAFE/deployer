/**
 * Reachability Module
 *
 * Feature module providing HTTP endpoints for URL reachability checking,
 * domain DNS resolution, per-node network config, and the stack's ingress
 * lanes (the public edge through its provider + the DNS records the lanes need)
 * and the mesh view.
 */
import { Module } from "@nestjs/common";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { ProvidersDomainModule } from "../providers/providers.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { ReachabilityController } from "./controllers/reachability.controller";
import { EdgeDnsService } from "./services/edge-dns.service";
import { IngressEdgeService } from "./services/ingress-edge.service";

@Module({
    imports: [CoreReachabilityModule, CorePlatformIngressModule, ProvidersDomainModule, TraefikCoreModule],
    controllers: [ReachabilityController],
    providers: [IngressEdgeService, EdgeDnsService],
})
export class ReachabilityDomainModule {}
