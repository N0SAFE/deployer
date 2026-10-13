import { Global, Module } from '@nestjs/common';
import { GlobalDatabaseModule } from '@/core/modules/database/global/global-database.module';
import { EventsModule } from '@/core/modules/events/events.module';
import { NodeStateModule } from '@/core/modules/node-state/node-state.module';
import { CoreEdgeModule } from '@/core/modules/edge/edge.module';
import { EnvModule } from '@/config/env/env.module';
import { ReachabilityService } from '@/core/modules/reachability/services/reachability.service';
import { PublicEdgeService } from '@/core/modules/reachability/services/public-edge.service';
import { PublicAccessPointService } from '@/core/modules/reachability/services/public-access-point.service';
import { PublicAccessPointEventService } from '@/core/modules/reachability/events/public-access-point-event.service';
import { NodeNetworkConfigRepository } from '@/core/modules/reachability/repositories/node-network-config.repository';

/**
 * CORE: Reachability + Public Access Point.
 *
 * @Global() so ANY module can inject PublicAccessPointService (the first-class
 * public access point) or watch the global event relay without importing this
 * module. The access point is derived from the per-node network config (IP /
 * hostname / DNS-provider tunnel) + a live probe, and broadcast over the core
 * event system as a Zod discriminated-union state.
 */
@Global()
@Module({
  imports: [GlobalDatabaseModule, EventsModule, NodeStateModule, CoreEdgeModule, EnvModule],
  providers: [
    // NodeConfigRepository comes from NodeStateModule (the single owner of the
    // local node-state repositories) — redeclaring it here created a SECOND
    // instance and triggered the SC8 duplication guard.
    NodeNetworkConfigRepository,
    ReachabilityService,
    PublicEdgeService,
    PublicAccessPointEventService,
    PublicAccessPointService,
  ],
  exports: [
    ReachabilityService,
    PublicEdgeService,
    PublicAccessPointEventService,
    PublicAccessPointService,
  ],
})
export class CoreReachabilityModule {}
