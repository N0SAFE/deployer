import type { Context } from 'effect';

import { NodeConfigRepository, type NodeConfigRepositoryShape } from '@deployer/node-state';
import { createGlobalModule } from '@deployer/nest-effect';

import { EnvModule, EnvService } from '../../../config/env/env.module';
import { DatabasePort } from '../database/storage';
import { EdgeProviderRegistry, type EdgeProviderRegistryShape } from '../edge/edge-provider.registry';
import { EgressService } from '../egress/egress.service';
import { IngressLanesService } from '../platform-ingress/services/ingress-lanes.service';
import { GlobalDatabaseModule } from '../database/global/global-database.module';
import { CoreEdgeModule } from '../edge/edge.module';
import { CoreEgressModule } from '../egress/egress.module';
import { EventsModule } from '../events/events.module';
import { NodeStateModule } from '../node-state/node-state.module';

import { PublicAccessPointEventService } from './events/public-access-point-event.service';
import { makeNodeNetworkConfigRepository, NodeNetworkConfigRepository, type NodeNetworkConfigRepositoryShape } from './repositories/node-network-config.repository';
import { makePublicAccessPointService, PublicAccessPointService } from './services/public-access-point.service';
import { makePublicEdgeService, PublicEdgeService, type PublicEdgeServiceShape } from './services/public-edge.service';
import { makeReachabilityService, ReachabilityService, type ReachabilityServiceShape } from './services/reachability.service';

/**
 * CORE: Reachability + Public Access Point.
 *
 * @Global() so ANY module can inject PublicAccessPointService (the first-class
 * public access point) or watch the global event relay without importing this
 * module. The access point is derived from the per-node network config (IP /
 * hostname / DNS-provider tunnel) + a live probe, and broadcast over the core
 * event system as a Zod discriminated-union state.
 */
export const CoreReachabilityModule = createGlobalModule({
  imports: [GlobalDatabaseModule, EventsModule, NodeStateModule, CoreEdgeModule, EnvModule, CoreEgressModule],
  providers: [
    // NodeConfigRepository comes from NodeStateModule (the single owner of the
    // local node-state repositories) — redeclaring it here created a SECOND
    // instance and triggered the SC8 duplication guard.
    {
      provide: NodeNetworkConfigRepository,
      useFactory: (database: Context.Service.Shape<typeof DatabasePort>) => makeNodeNetworkConfigRepository(database),
      inject: [DatabasePort],
    },
    {
      provide: PublicEdgeService,
      useFactory: (registry: EdgeProviderRegistryShape, nodeConfigs: NodeNetworkConfigRepositoryShape, env: EnvService) =>
        makePublicEdgeService({ registry, nodeConfigs, prefix: env.get('DEPLOYER_PREFIX') }),
      inject: [EdgeProviderRegistry, NodeNetworkConfigRepository, EnvService],
    },
    {
      provide: ReachabilityService,
      useFactory: (
        nodeNetworkConfigs: NodeNetworkConfigRepositoryShape,
        nodeConfig: NodeConfigRepositoryShape,
        lanes: IngressLanesService,
        edges: EdgeProviderRegistryShape,
        publicEdge: PublicEdgeServiceShape,
        egress: EgressService,
      ) => makeReachabilityService({ nodeNetworkConfigs, nodeConfig, lanes, edges, publicEdge, egress }),
      inject: [NodeNetworkConfigRepository, NodeConfigRepository, IngressLanesService, EdgeProviderRegistry, PublicEdgeService, EgressService],
    },
    PublicAccessPointEventService,
    {
      provide: PublicAccessPointService,
      useFactory: (reachability: ReachabilityServiceShape, accessPointEvents: PublicAccessPointEventService) =>
        makePublicAccessPointService({ reachability, accessPointEvents }),
      inject: [ReachabilityService, PublicAccessPointEventService],
    },
  ],
  exports: [
    ReachabilityService,
    PublicEdgeService,
    PublicAccessPointEventService,
    PublicAccessPointService,
  ],
});
