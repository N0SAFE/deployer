import type { NodeDoorClient } from '@deployer/mesh-client'
import type { EdgeProviderRegistry } from '@deployer/shared/core/modules/edge/edge-provider.registry'
import type { EgressService } from '@deployer/shared/core/modules/egress/egress.service'
import type { HostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'
import type { IngressLanesService } from '@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service'
import type { PublicAccessPointService } from '@deployer/shared/core/modules/reachability/services/public-access-point.service'
import type { PublicEdgeService } from '@deployer/shared/core/modules/reachability/services/public-edge.service'
import type { ReachabilityService } from '@deployer/shared/core/modules/reachability/services/reachability.service'
import type { TraefikConfigRefresher } from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'
import { Context } from 'effect'

/**
 * The shared platform services reachability depends on, as Effect ports.
 *
 * They are still Promise-based Nest providers owned by `shared`; each tag is registered in the module
 * with `useExisting`, so a Layer asks for the port without importing Nest. A port is the seam a test
 * replaces with a fake and the place a service is rewritten later without touching its callers.
 */
export class IngressLanesPort extends Context.Service<
    IngressLanesPort,
    IngressLanesService
>()('fleet/IngressLanesPort') {}
export class EdgeProvidersPort extends Context.Service<
    EdgeProvidersPort,
    EdgeProviderRegistry
>()('fleet/EdgeProvidersPort') {}
export class PublicEdgePort extends Context.Service<
    PublicEdgePort,
    PublicEdgeService
>()('fleet/PublicEdgePort') {}
/** This node's NEW mesh agent, asked over its node door (local socket only). Null answer = no agent. */
export class NodeAgentPort extends Context.Service<
    NodeAgentPort,
    NodeDoorClient
>()('fleet/NodeAgentPort') {}
export class HostnamesPort extends Context.Service<
    HostnamesPort,
    HostnameService
>()('fleet/HostnamesPort') {}
export class TraefikRefresherPort extends Context.Service<
    TraefikRefresherPort,
    TraefikConfigRefresher
>()('fleet/TraefikRefresherPort') {}
export class ReachabilityCorePort extends Context.Service<
    ReachabilityCorePort,
    ReachabilityService
>()('fleet/ReachabilityCorePort') {}
export class PublicAccessPointPort extends Context.Service<
    PublicAccessPointPort,
    PublicAccessPointService
>()('fleet/PublicAccessPointPort') {}
export class EgressPort extends Context.Service<EgressPort, EgressService>()(
    'fleet/EgressPort'
) {}
