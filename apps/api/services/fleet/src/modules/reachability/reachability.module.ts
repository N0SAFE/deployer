/**
 * Reachability Module
 *
 * Feature module providing HTTP endpoints for URL reachability checking,
 * domain DNS resolution, per-node network config, and the stack's ingress
 * lanes (the public edge through its provider + the DNS records the lanes need)
 * and the mesh view.
 *
 * The use cases are Effect services (`static readonly live`, provided with `useClass`) that yield
 * their collaborators when a method runs. The shared platform services they depend on stay Nest
 * providers and are exposed to the Effect side as ports with `useExisting`.
 */
import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext, EffectHost } from '@deployer/nest-effect'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'
import { EdgeProviderRegistry } from '@deployer/shared/core/modules/edge/edge-provider.registry'
import { EgressService } from '@deployer/shared/core/modules/egress/egress.service'
import { CorePlatformIngressModule } from '@deployer/shared/core/modules/platform-ingress/platform-ingress.module'
import { HostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'
import { IngressLanesService } from '@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service'
import { CoreReachabilityModule } from '@deployer/shared/core/modules/reachability/core-reachability.module'
import { PublicAccessPointService } from '@deployer/shared/core/modules/reachability/services/public-access-point.service'
import { PublicEdgeService } from '@deployer/shared/core/modules/reachability/services/public-edge.service'
import { ReachabilityService } from '@deployer/shared/core/modules/reachability/services/reachability.service'
import { TraefikConfigRefresher } from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'
import { TraefikCoreModule } from '@deployer/shared/core/modules/traefik/traefik.module'

import { ProvidersModule } from '@/modules/providers/providers.module'

import { ReachabilityController } from './controllers/reachability.controller'
import {
    EdgeProvidersPort,
    EgressPort,
    HostnamesPort,
    IngressLanesPort,
    NodeAgentPort,
    PublicAccessPointPort,
    PublicEdgePort,
    ReachabilityCorePort,
    TraefikRefresherPort,
} from './reachability.ports'
import { EdgeDnsService } from './services/edge-dns.service'
import {
    INGRESS_DNS_RECONCILER,
    startIngressDnsReconciler,
} from './services/ingress-dns-reconciler'
import { IngressEdgeService } from './services/ingress-edge.service'
import { NodeReachabilityService } from './services/node-reachability.service'

export class ReachabilityModule extends createModuleContext({
    imports: [
        CoreReachabilityModule,
        CorePlatformIngressModule,
        ProvidersModule,
        TraefikCoreModule,
        EnvModule,
    ],
    controllers: [ReachabilityController],
    providers: [
        { provide: IngressLanesPort, useExisting: IngressLanesService },
        { provide: EdgeProvidersPort, useExisting: EdgeProviderRegistry },
        { provide: PublicEdgePort, useExisting: PublicEdgeService },
        // The mesh view and member revocation ask this node's NEW agent over its node door; a node without one
        // answers null on every call, which the service reports as "no agent" rather than inventing a mesh.
        {
            provide: NodeAgentPort,
            useFactory: (env: EnvService) => nodeDoorFromEnv(env),
            inject: [EnvService],
        },
        { provide: HostnamesPort, useExisting: HostnameService },
        { provide: TraefikRefresherPort, useExisting: TraefikConfigRefresher },
        { provide: ReachabilityCorePort, useExisting: ReachabilityService },
        {
            provide: PublicAccessPointPort,
            useExisting: PublicAccessPointService,
        },
        { provide: EgressPort, useExisting: EgressService },
        { provide: EdgeDnsService, useClass: EdgeDnsService.live },
        { provide: IngressEdgeService, useClass: IngressEdgeService.live },
        {
            provide: NodeReachabilityService,
            useClass: NodeReachabilityService.live,
        },
        // Converges lane DNS on a cadence from when the module is built; stopped with the application.
        {
            provide: INGRESS_DNS_RECONCILER,
            useFactory: startIngressDnsReconciler,
            inject: [EffectHost],
        },
    ],
}) {}
