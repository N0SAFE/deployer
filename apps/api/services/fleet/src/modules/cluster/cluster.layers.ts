import { ClusterService } from './services/cluster.service'

/** The cluster feature: the service over the swarm ports. The event hub stays a Nest provider. */
export const ClusterLive = ClusterService.Live
