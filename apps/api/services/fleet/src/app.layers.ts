import { Layer } from 'effect'

import { PlatformLive } from "./modules/platform/platform.layers";
import { ClusterLive } from "./modules/cluster/cluster.layers";
import { FleetFeatureLive } from "./modules/fleet/fleet.layers";
import { ReachabilityLive } from "./modules/reachability/reachability.layers";
import { ProviderSchemaLive } from './modules/provider-schema/provider-schema.layers'

/**
 * Everything the fleet service's Effect runtime builds. Fleet is migrating module by module off
 * Promise-based Nest classes: a module is listed here once its service is a Layer.
 */
export const FleetLive = Layer.mergeAll(ProviderSchemaLive, ReachabilityLive, FleetFeatureLive, ClusterLive, PlatformLive)
