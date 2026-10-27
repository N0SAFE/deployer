import { Layer } from 'effect'

import { EdgeDnsService } from './services/edge-dns.service'
import { IngressEdgeService } from './services/ingress-edge.service'
import { NodeReachabilityService } from './services/node-reachability.service'

/**
 * The reachability feature: DNS convergence, the ingress lanes over it, and the node probes. The
 * platform services they need are ports provided by the Nest module (see `reachability.module.ts`).
 */
export const ReachabilityLive = Layer.mergeAll(
    IngressEdgeService.Live,
    NodeReachabilityService.Live
).pipe(Layer.provideMerge(EdgeDnsService.Live))
